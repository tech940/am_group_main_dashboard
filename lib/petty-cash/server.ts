import 'server-only'

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
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
import {
  canAccessPettyCash,
  canApprovePettyCashStage,
  canCreatePettyCashExpense,
  canCreatePettyCashRequest,
  canManagePettyCashBranch,
  canReadPettyCashExpense,
  canReadPettyCashRequest,
  canUsePettyCashAllocation,
  canViewPettyCashBranch,
  hasPettyCashAllBranchAccess,
  getPettyCashAllocationVisibilityFilter,
  getPettyCashExpenseVisibilityFilter,
  getPettyCashRequestVisibilityFilter,
} from './access'
import { PETTY_CASH_TOP_UP_THRESHOLD, isPettyCashExpenseStatus, isPettyCashRequestStatus } from './constants'
import { sendPettyCashApprovalEmail } from './emails'

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
  // Location the money was spent for (tracked per expense; stored inside expenseForm.location).
  location: optionalText,
  expenseForm: z.record(z.string(), z.unknown()).default({}),
  billFiles: z
    .array(z.string().trim().min(1, 'Bill file URL cannot be empty.'))
    .min(1, 'Please upload at least one bill image or PDF.'),
})

export const pettyCashWorkflowSchema = z.object({
  id: uuidSchema,
  action: z.enum(['approve', 'reject', 'hold']),
  stage: z.enum(['ed_approval', 'ea_approval', 'md_approval', 'accounts']),
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
  return parseMoney(allocation.allocatedAmount) - parseMoney(allocation.spentAmount)
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

  if (appUser.role === 'md' || appUser.role === 'eba') {
    return requests.filter((request) => ['md_pending', 'md_on_hold', 'ea_pending', 'ea_on_hold', 'ed_approved', 'submitted', 'ed_pending', 'ed_on_hold'].includes(String(request.status || '')))
  }

  if (appUser.role === 'accounts') {
    return requests.filter((request) => ['accounts_pending', 'accounts_on_hold'].includes(String(request.status || '')))
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin' || appUser.role === 'sales_manager') {
    return requests.filter((request) => (
      String(request.createdBy || '') === appUser.id
      && CREATOR_REQUEST_QUEUE_STATUSES.has(String(request.status || ''))
    ))
  }

  return requests
}

function filterDashboardExpenses(appUser: AppUser, expenses: Array<Record<string, unknown>>) {
  // Only the Branch Admin (the submitter) is limited to their own expenses.
  // Admin / MD / EA / Accounts / super admin see the full (branch-scoped) feed so
  // they can review and filter location-wise.
  if (appUser.role === 'branch_admin' || appUser.role === 'sales_manager') {
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
    if (!canViewPettyCashBranch(appUser, query.branchId)) throw new Error('Forbidden branch')
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

type PettyCashRequestStatus = (typeof pettyCashRequests.$inferSelect)['status']

const PETTY_CASH_APPROVAL_STATUSES = {
  ed_approval: ['submitted', 'ed_pending', 'ed_on_hold'],
  ea_approval: ['ea_pending', 'ea_on_hold', 'ed_approved'],
  md_approval: ['md_pending', 'md_on_hold'],
  accounts: ['accounts_pending', 'accounts_on_hold'],
} as const satisfies Record<string, readonly PettyCashRequestStatus[]>

/** Which approval stage a request's status currently sits at (null if terminal/creator-side). */
export function pettyCashStageForStatus(status: string): 'ed_approval' | 'ea_approval' | 'md_approval' | 'accounts' | null {
  if (status === 'submitted' || status === 'ed_pending' || status === 'ed_on_hold') return 'ed_approval'
  if (status === 'ea_pending' || status === 'ea_on_hold' || status === 'ed_approved') return 'ea_approval'
  if (status === 'md_pending' || status === 'md_on_hold') return 'md_approval'
  if (status === 'accounts_pending' || status === 'accounts_on_hold') return 'accounts'
  return null
}

/** The request statuses that belong in a given role's pending-approval queue. */
function pettyCashApprovalStatusesForRole(role: AppUser['role']): PettyCashRequestStatus[] {
  if (!role) return []
  const r = String(role).trim().toLowerCase()
  const isAccounts = r === 'accounts' || r === 'accounts_head' || r === 'accounts_team' || r === 'finance_head' || r === 'finance_team'

  if (r === 'ed') return [...PETTY_CASH_APPROVAL_STATUSES.ed_approval]
  if (r === 'ea') return [...PETTY_CASH_APPROVAL_STATUSES.ea_approval]
  if (r === 'md' || r === 'eba' || r === 'developer') {
    return [
      ...PETTY_CASH_APPROVAL_STATUSES.ed_approval,
      ...PETTY_CASH_APPROVAL_STATUSES.ea_approval,
      ...PETTY_CASH_APPROVAL_STATUSES.md_approval,
      ...PETTY_CASH_APPROVAL_STATUSES.accounts,
    ]
  }
  if (isAccounts) return [...PETTY_CASH_APPROVAL_STATUSES.accounts]
  return []
}

/** Pending petty-cash requests awaiting the current user's action, enriched for the approval UI. */
export async function getPettyCashApprovalQueue(appUser: AppUser, opts?: { search?: string | null; branchId?: string | null }) {
  const statuses = pettyCashApprovalStatusesForRole(appUser.role)
  if (statuses.length === 0) return { count: 0, requests: [] as Array<Record<string, unknown>> }

  const filters = [getPettyCashRequestVisibilityFilter(appUser), inArray(pettyCashRequests.status, statuses)]

  if (opts?.branchId && opts.branchId !== 'all') {
    if (!isBranchValue(opts.branchId)) throw new Error('Invalid branch')
    if (!canViewPettyCashBranch(appUser, opts.branchId)) throw new Error('Forbidden branch')
    filters.push(eq(pettyCashRequests.branchId, opts.branchId))
  }

  const search = (opts?.search || '').trim()
  if (search) {
    filters.push(or(
      ilike(pettyCashRequests.requestNumber, `%${search}%`),
      ilike(pettyCashRequests.requestedByName, `%${search}%`),
      ilike(pettyCashRequests.purpose, `%${search}%`)
    )!)
  }

  const rows = await db
    .select()
    .from(pettyCashRequests)
    .where(and(...filters))
    .orderBy(desc(pettyCashRequests.createdAt))
    .limit(200)

  const requestIds = rows.map((row) => row.id)
  if (requestIds.length === 0) return { count: 0, requests: [] as Array<Record<string, unknown>> }

  // Batched: one query each for categories, ALL approval-history rows, and ALL allocations across the
  // whole page, then grouped in JS. Replaces the old per-row fan-out (2 queries + a getUserMap call per
  // row → ~600 statements for a 200-row queue) with 4 statements total. petty_cash_allocations has a
  // UNIQUE index on request_id, so there is at most one allocation per request.
  const [categories, histories, allocations] = await Promise.all([
    getPettyCashCategories(),
    db.select().from(pettyCashApprovalHistory).where(inArray(pettyCashApprovalHistory.requestId, requestIds)).orderBy(asc(pettyCashApprovalHistory.createdAt)),
    db.select().from(pettyCashAllocations).where(inArray(pettyCashAllocations.requestId, requestIds)),
  ])
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]))

  // Group by request. `histories` is globally sorted by created_at ASC, so pushing in iteration order
  // preserves per-request ASC order — identical to the old per-row `orderBy(asc(createdAt))`.
  const historyByRequest = new Map<string, typeof histories>()
  for (const item of histories) {
    if (!item.requestId) continue
    const list = historyByRequest.get(item.requestId)
    if (list) list.push(item)
    else historyByRequest.set(item.requestId, [item])
  }
  const allocationByRequest = new Map<string, (typeof allocations)[number]>()
  for (const allocation of allocations) {
    if (allocation.requestId && !allocationByRequest.has(allocation.requestId)) {
      allocationByRequest.set(allocation.requestId, allocation)
    }
  }

  // One users lookup for every actor across the whole page (getUserMap already dedupes + batches).
  const userMap = await getUserMap([
    ...histories.map((item) => item.performedBy),
    ...rows.map((row) => row.createdBy),
  ])

  const requests = rows.map((row) => {
    const history = historyByRequest.get(row.id) ?? []
    const allocation = allocationByRequest.get(row.id) ?? null

    return {
      ...serializeRequest(row),
      stage: pettyCashStageForStatus(String(row.status)),
      categoryName: row.categoryId ? categoryMap.get(row.categoryId) || null : null,
      location: row.requestForm?.location ?? null,
      typeOfPayment: row.requestForm?.typeOfPayment ?? null,
      allocation: allocation ? serializeAllocation(allocation as any) : null,
      history: history.map((item) => ({
        ...serializeHistory(item),
        performedByName: userMap.get(item.performedBy)?.fullName || item.performedBy,
        performedByEmail: userMap.get(item.performedBy)?.email || null,
      })),
    }
  })

  return { count: rows.length, requests }
}

/** Lightweight badge count of pending petty-cash approvals for the current user. */
export async function getPettyCashApprovalCount(appUser: AppUser) {
  const statuses = pettyCashApprovalStatusesForRole(appUser.role)
  if (statuses.length === 0) return 0
  const [{ total }] = await db
    .select({ total: count() })
    .from(pettyCashRequests)
    .where(and(getPettyCashRequestVisibilityFilter(appUser), inArray(pettyCashRequests.status, statuses)))
  return Number(total) || 0
}

/**
 * Status-tracking board feed: every petty-cash request the user is allowed to
 * see, with the fields the board needs to derive the current stage, pending
 * approver, and how long it has been waiting.
 *
 * "Waiting since" is taken from `updatedAt`. Every workflow transition
 * (submit / EA / MD / Accounts / hold) stamps `updatedAt = now`, so it is an
 * accurate marker of when the request entered its *current* status. There is no
 * dedicated per-stage "entered at" column, so this is an approximation for
 * requests that were edited for any other reason — in practice petty-cash
 * requests are only ever touched by the workflow, so it holds.
 */
export async function getPettyCashStatusBoard(appUser: AppUser) {
  const rows = await db
    .select({
      id: pettyCashRequests.id,
      requestNumber: pettyCashRequests.requestNumber,
      branchId: pettyCashRequests.branchId,
      status: pettyCashRequests.status,
      requestedByName: pettyCashRequests.requestedByName,
      requestedByEmail: pettyCashRequests.requestedByEmail,
      createdBy: pettyCashRequests.createdBy,
      requestedAmount: pettyCashRequests.requestedAmount,
      purpose: pettyCashRequests.purpose,
      department: pettyCashRequests.department,
      createdAt: pettyCashRequests.createdAt,
      updatedAt: pettyCashRequests.updatedAt,
    })
    .from(pettyCashRequests)
    .where(getPettyCashRequestVisibilityFilter(appUser))
    .orderBy(desc(pettyCashRequests.updatedAt))
    .limit(500)

  return {
    generatedAt: new Date().toISOString(),
    currentUserId: appUser.id,
    currentUserEmail: appUser.email,
    currentUserName: appUser.fullName,
    currentUserRole: appUser.role,
    requests: rows.map((row) => serializeUtcTimestampFields(row as Record<string, unknown>, ['createdAt', 'updatedAt'])),
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
    if (!canViewPettyCashBranch(appUser, query.branchId)) throw new Error('Forbidden branch')
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
  // Department lives on the originating request; location is now captured per-expense
  // (expenseForm.location) with a fallback to the request's location for legacy expenses, so
  // back-office roles can see and filter by the location the money was actually spent for.
  const rows = await db
    .select({
      expense: pettyCashExpenses,
      location: sql<string | null>`COALESCE(${pettyCashExpenses.expenseForm} ->> 'location', ${pettyCashRequests.requestForm} ->> 'location')`,
      department: pettyCashRequests.department,
    })
    .from(pettyCashExpenses)
    .leftJoin(pettyCashAllocations, eq(pettyCashAllocations.id, pettyCashExpenses.allocationId))
    .leftJoin(pettyCashRequests, eq(pettyCashRequests.id, pettyCashAllocations.requestId))
    .where(whereExpression)
    .orderBy(desc(pettyCashExpenses.createdAt))
    .limit(query.pageSize)
    .offset(offset)

  return {
    expenses: rows.map((row) => ({ ...serializeExpense(row.expense as Record<string, unknown>), location: row.location || null, department: row.department || null })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total) || 0,
      totalPages: Math.max(1, Math.ceil((Number(total) || 0) / query.pageSize)),
    },
  }
}

export async function getCurrentPettyCashAllocation(appUser: AppUser, branchId?: string | null) {
  // Cross-branch supervisors (EA/MD/EBA/Developer/all) don't own a single
  // allocation — the "current allocation" KPI is only meaningful once they pick a
  // branch. Without one, return null and let them use the Allocations list.
  if (hasPettyCashAllBranchAccess(appUser) && !branchId) return null

  const filters = [getPettyCashAllocationVisibilityFilter(appUser)]

  if (branchId && branchId !== 'all') {
    if (!isBranchValue(branchId)) throw new Error('Invalid branch')
    if (!canViewPettyCashBranch(appUser, branchId)) throw new Error('Forbidden branch')
    filters.push(eq(pettyCashAllocations.branchId, branchId))
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin' || appUser.role === 'sales_manager') {
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

/**
 * List active allocations the user may see, one row per branch/dealership. For
 * cross-branch supervisors (EA/MD/EBA/Developer) this spans every brand and
 * every location so they can review and filter allocations org-wide. `location`
 * (the dealership, e.g. KIA Jammu / KIA Udhampur) is pulled from the originating
 * request's requestForm so the UI can offer a Location/Dealership filter.
 */
/**
 * Lifetime totals for the KPI row — every allocation this user may see, since petty cash began.
 *
 * The cards used to reduce over whatever the Allocations TAB had fetched, and that list defaults to
 * "Open only". So "TOTAL SPENT" silently meant "spent on allocations that happen to still be open",
 * and flipping a filter on another tab changed the headline numbers. This aggregates in Postgres over
 * the full history instead, so the figure is stable and actually answers "since we started".
 *
 * `remaining` is deliberately NOT lifetime — unspent cash is a right-now quantity, so it sums only
 * open floats. Reuses getPettyCashAllocationVisibilityFilter, so a branch-scoped user can never be
 * shown totals from a branch they cannot see.
 */
export async function getPettyCashLifetimeTotals(appUser: AppUser, branchId?: string | null) {
  const scope = (includeInactive: boolean) => {
    const filters = [getPettyCashAllocationVisibilityFilter(appUser, { includeInactive })]
    if (branchId && branchId !== 'all') {
      if (!isBranchValue(branchId)) throw new Error('Invalid branch')
      if (!canViewPettyCashBranch(appUser, branchId)) throw new Error('Forbidden branch')
      filters.push(eq(pettyCashAllocations.branchId, branchId))
    }
    return and(...filters)
  }

  const [[lifetime], [open]] = await Promise.all([
    db.select({
      allocationCount: sql<number>`COUNT(*)::int`,
      allocated: sql<string>`COALESCE(SUM(${pettyCashAllocations.allocatedAmount}), 0)::text`,
      spent: sql<string>`COALESCE(SUM(${pettyCashAllocations.spentAmount}), 0)::text`,
      since: sql<string | null>`MIN(${pettyCashAllocations.allocatedAt})::text`,
    }).from(pettyCashAllocations).where(scope(true)),
    db.select({
      openCount: sql<number>`COUNT(*)::int`,
      remaining: sql<string>`COALESCE(SUM(${pettyCashAllocations.allocatedAmount} - ${pettyCashAllocations.spentAmount}), 0)::text`,
    }).from(pettyCashAllocations).where(scope(false)),
  ])

  return {
    allocationCount: Number(lifetime?.allocationCount ?? 0),
    allocatedTotal: parseMoney(lifetime?.allocated ?? '0'),
    spentTotal: parseMoney(lifetime?.spent ?? '0'),
    since: lifetime?.since ?? null,
    openAllocationCount: Number(open?.openCount ?? 0),
    remainingNow: parseMoney(open?.remaining ?? '0'),
  }
}

export async function listPettyCashAllocations(
  appUser: AppUser,
  input?: { branchId?: string | null; status?: string | null },
) {
  // 'all' switches the list from the single open float to the full allocation HISTORY — which is
  // the only way to answer "when did this person last get money". Every past allocation is
  // status='closed', so the default active-only filter hides all of it.
  const includeInactive = String(input?.status || 'active').toLowerCase() === 'all'
  const filters = [getPettyCashAllocationVisibilityFilter(appUser, { includeInactive })]

  const branchId = input?.branchId
  if (branchId && branchId !== 'all') {
    if (!isBranchValue(branchId)) throw new Error('Invalid branch')
    if (!canViewPettyCashBranch(appUser, branchId)) throw new Error('Forbidden branch')
    filters.push(eq(pettyCashAllocations.branchId, branchId))
  }

  // Two separate joins onto `users`: the recipient AND the person who released the money. Only the
  // recipient was joined before, so allocatedBy reached the client as a bare UUID and "who
  // allocated it" was unanswerable in the UI.
  const allocatedByUser = alias(users, 'allocated_by_user')

  const rows = await db
    .select({
      allocation: pettyCashAllocations,
      location: sql<string | null>`${pettyCashRequests.requestForm} ->> 'location'`,
      department: pettyCashRequests.department,
      allocatedToName: users.fullName,
      allocatedByName: allocatedByUser.fullName,
      // Spend window per allocation, on expense_date (the date money actually left the tin), not
      // created_at (when the row was typed in) — 39% of rows differ, by up to 9 days.
      firstSpendDate: sql<string | null>`(
        SELECT MIN(e.expense_date)::text FROM petty_cash_expenses e
        WHERE e.allocation_id = ${pettyCashAllocations.id} AND e.status = 'approved' AND e.deleted_at IS NULL
      )`,
      lastSpendDate: sql<string | null>`(
        SELECT MAX(e.expense_date)::text FROM petty_cash_expenses e
        WHERE e.allocation_id = ${pettyCashAllocations.id} AND e.status = 'approved' AND e.deleted_at IS NULL
      )`,
      spendCount: sql<number>`(
        SELECT COUNT(*)::int FROM petty_cash_expenses e
        WHERE e.allocation_id = ${pettyCashAllocations.id} AND e.status = 'approved' AND e.deleted_at IS NULL
      )`,
    })
    .from(pettyCashAllocations)
    .leftJoin(pettyCashRequests, eq(pettyCashRequests.id, pettyCashAllocations.requestId))
    .leftJoin(users, eq(users.id, pettyCashAllocations.allocatedTo))
    .leftJoin(allocatedByUser, eq(allocatedByUser.id, pettyCashAllocations.allocatedBy))
    .where(and(...filters))
    // Newest allocation first — with history switched on, "their last allocation" is now row one.
    .orderBy(desc(pettyCashAllocations.allocatedAt))
    .limit(200)

  return {
    allocations: rows.map((row) => ({
      ...serializeAllocation(row.allocation as Record<string, unknown>),
      location: row.location || null,
      department: row.department || null,
      allocatedToName: row.allocatedToName || null,
      allocatedByName: row.allocatedByName || null,
      firstSpendDate: row.firstSpendDate || null,
      lastSpendDate: row.lastSpendDate || null,
      spendCount: Number(row.spendCount) || 0,
      remainingAmount: toMoney(getRemainingBalance(row.allocation)),
    })),
  }
}

/**
 * Day-by-day spend against ONE allocation: what was spent, on which date, by whom.
 *
 * Buckets on `expense_date` — the date the spender says the money went out — because that is what
 * "spending based on date" means to the people reading it. `created_at` is when the row was keyed
 * in, and the two disagree on ~39% of live rows (up to 9 days apart).
 *
 * Only 'approved' non-deleted expenses count, matching what allocations.spent_amount tracks and the
 * CA section's rollup (lib/ca/ca-data.ts), so the totals here reconcile with the Spent column.
 */
export async function getPettyCashAllocationSpend(appUser: AppUser, allocationId: string) {
  uuidSchema.parse(allocationId)

  // Authorise via the SAME visibility filter as the list (history included), so this cannot be used
  // to read an allocation the caller could not already see.
  const [allocation] = await db
    .select({
      allocation: pettyCashAllocations,
      allocatedToName: users.fullName,
    })
    .from(pettyCashAllocations)
    .leftJoin(users, eq(users.id, pettyCashAllocations.allocatedTo))
    .where(and(
      getPettyCashAllocationVisibilityFilter(appUser, { includeInactive: true }),
      eq(pettyCashAllocations.id, allocationId),
    ))
    .limit(1)

  if (!allocation) throw new Error('Forbidden')

  const spenderUser = alias(users, 'spender_user')
  const rows = await db
    .select({
      expenseNumber: pettyCashExpenses.expenseNumber,
      expenseDate: pettyCashExpenses.expenseDate,
      amount: pettyCashExpenses.amount,
      particulars: pettyCashExpenses.particulars,
      purpose: pettyCashExpenses.purpose,
      vendorName: pettyCashExpenses.vendorName,
      createdAt: pettyCashExpenses.createdAt,
      spentByName: spenderUser.fullName,
    })
    .from(pettyCashExpenses)
    .leftJoin(spenderUser, eq(spenderUser.id, pettyCashExpenses.createdBy))
    .where(and(
      eq(pettyCashExpenses.allocationId, allocationId),
      eq(pettyCashExpenses.status, 'approved'),
      isNull(pettyCashExpenses.deletedAt),
    ))
    .orderBy(desc(pettyCashExpenses.expenseDate), desc(pettyCashExpenses.createdAt))
    .limit(500)

  // Group into days in JS rather than SQL: the same query then serves both the per-day totals and
  // the individual lines under each day, in one round trip (the pooler charges ~225ms per query).
  const byDate = new Map<string, { date: string; total: number; items: typeof entries }>()
  const entries = rows.map((r) => ({
    expenseNumber: r.expenseNumber,
    expenseDate: String(r.expenseDate),
    amount: toMoney(r.amount),
    description: r.particulars || r.purpose || '',
    vendorName: r.vendorName || '',
    spentByName: r.spentByName || null,
    // Flags a back-dated entry: the spend date precedes the day it was recorded.
    recordedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  }))

  for (const item of entries) {
    const bucket = byDate.get(item.expenseDate) || { date: item.expenseDate, total: 0, items: [] }
    bucket.total += Number(item.amount) || 0
    bucket.items.push(item)
    byDate.set(item.expenseDate, bucket)
  }

  const days = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((d) => ({ ...d, total: toMoney(d.total) }))

  return {
    allocation: {
      ...serializeAllocation(allocation.allocation as Record<string, unknown>),
      allocatedToName: allocation.allocatedToName || null,
      remainingAmount: toMoney(getRemainingBalance(allocation.allocation)),
    },
    days,
    totalSpent: toMoney(entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
    expenseCount: entries.length,
  }
}

export async function getPettyCashDashboard(appUser: AppUser, branchId?: string | null) {
  const [categories, currentAllocation, requestsResult, expensesResult, lifetime] = await Promise.all([
    getPettyCashCategories(),
    getCurrentPettyCashAllocation(appUser, branchId),
    // Wide window so the reviewer's visible queue matches the authoritative pending
    // count (getPettyCashApprovalCount) rather than trailing an 8-row slice.
    listPettyCashRequests(appUser, { page: 1, pageSize: 50, status: 'all', branchId }),
    // Fetch a wide window of expenses so the location filter has enough to work with.
    listPettyCashExpenses(appUser, { page: 1, pageSize: 50, status: 'all', branchId }),
    getPettyCashLifetimeTotals(appUser, branchId),
  ])

  const requests = filterDashboardRequests(appUser, requestsResult.requests as Array<Record<string, unknown>>)
  const expenses = filterDashboardExpenses(appUser, expensesResult.expenses as Array<Record<string, unknown>>)
  // Single source of truth for the pending badge: approver/supervisor roles use
  // the exact same count as Purchase Orders → Petty Cash (getPettyCashApprovalCount),
  // so the two surfaces can never disagree. Creators fall back to their own
  // in-flight requests (filterDashboardRequests already scopes to them).
  const pendingRequestCount = pettyCashApprovalStatusesForRole(appUser.role).length
    ? await getPettyCashApprovalCount(appUser)
    : requests.length
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
      // Lifetime figures for the KPI row — independent of any tab filter. See getPettyCashLifetimeTotals.
      lifetimeAllocated: lifetime.allocatedTotal,
      lifetimeSpent: lifetime.spentTotal,
      lifetimeAllocationCount: lifetime.allocationCount,
      openAllocationCount: lifetime.openAllocationCount,
      remainingNow: lifetime.remainingNow,
      since: lifetime.since,
    },
  }
}

export async function createPettyCashRequest(appUser: AppUser, rawInput: unknown) {
  if (!canCreatePettyCashRequest(appUser.role)) {
    throw new Error('Forbidden')
  }

  const input = createPettyCashRequestSchema.parse(rawInput)
  const branchId = normalizeBranch(appUser)

  if (!branchId || !canManagePettyCashBranch(appUser, branchId)) {
    throw new Error('Forbidden branch')
  }

  const activeAllocation = await getActivePettyCashAllocationForScope(branchId, appUser.id)
  const topUpStatus = getTopUpStatus(activeAllocation)
  if (!topUpStatus.canRequestTopUp) {
    throw new Error(topUpStatus.topUpReason)
  }

  const status = input.status === 'draft' ? 'draft' : 'ed_pending'
  const currentStage = input.status === 'draft' ? 'draft' : 'ed_approval'

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
      submittedAt: status === 'draft' ? null : new Date(),
    })
    .returning()

  await db.insert(pettyCashApprovalHistory).values({
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
  })

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

  const now = new Date()
  const { expense } = await db.transaction(async (tx) => {
    const [updatedAllocation] = await tx
      .update(pettyCashAllocations)
      .set({
        spentAmount: sql`${pettyCashAllocations.spentAmount} + ${toMoney(input.amount)}::numeric`,
        updatedAt: now,
      })
      .where(and(
        eq(pettyCashAllocations.id, activeAllocation.id),
        eq(pettyCashAllocations.status, 'active')
      ))
      .returning()

    if (!updatedAllocation) throw new Error('Active petty cash allocation not found or updated')

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
      // Persist the per-expense location in the form JSON (mirrors requestForm.location).
      expenseForm: { ...input.expenseForm, location: input.location || null },
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

    await tx.insert(pettyCashApprovalHistory).values({
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
    })

    return { expense }
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

  if (input.stage === 'ed_approval') {
    if (!['submitted', 'ed_pending', 'ed_on_hold'].includes(request.status)) throw new Error('Request is not awaiting ED approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'ea_pending', currentStage: 'ea_approval', edApprovedBy: appUser.id, edApprovedAt: now, edRemarks: null }
      newStatus = 'ea_pending'
      newStage = 'ea_approval'
    } else if (input.action === 'hold') {
      updateData = { ...updateData, status: 'ed_on_hold', currentStage: 'ed_approval', edRemarks: input.remarks || null }
      newStatus = 'ed_on_hold'
      newStage = 'ed_approval'
    } else {
      updateData = { ...updateData, status: 'ed_rejected', currentStage: 'ed_approval', rejectedAt: now, rejectedBy: appUser.id, edRemarks: input.remarks || null }
      newStatus = 'ed_rejected'
    }
  } else if (input.stage === 'ea_approval') {
    if (!['ea_pending', 'ea_on_hold', 'ed_approved'].includes(request.status)) throw new Error('Request is not awaiting EA approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'md_pending', currentStage: 'md_approval', eaApprovedBy: appUser.id, eaApprovedAt: now, eaRemarks: null }
      newStatus = 'md_pending'
      newStage = 'md_approval'
    } else if (input.action === 'hold') {
      updateData = { ...updateData, status: 'ea_on_hold', currentStage: 'ea_approval', eaRemarks: input.remarks || null }
      newStatus = 'ea_on_hold'
      newStage = 'ea_approval'
    } else {
      updateData = { ...updateData, status: 'ea_rejected', currentStage: 'ea_approval', rejectedAt: now, rejectedBy: appUser.id, eaRemarks: input.remarks || null }
      newStatus = 'ea_rejected'
    }
  } else if (input.stage === 'md_approval') {
    if (!['md_pending', 'md_on_hold', 'ea_pending', 'ea_on_hold', 'ed_approved'].includes(request.status)) throw new Error('Request is not awaiting MD approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'accounts_pending', currentStage: 'accounts', mdApprovedBy: appUser.id, mdApprovedAt: now, mdRemarks: null }
      newStatus = 'accounts_pending'
      newStage = 'accounts'
    } else if (input.action === 'hold') {
      updateData = { ...updateData, status: 'md_on_hold', currentStage: 'md_approval', mdRemarks: input.remarks || null }
      newStatus = 'md_on_hold'
      newStage = 'md_approval'
    } else {
      updateData = { ...updateData, status: 'md_rejected', currentStage: 'md_approval', rejectedAt: now, rejectedBy: appUser.id, mdRemarks: input.remarks || null }
      newStatus = 'md_rejected'
    }
  } else if (input.stage === 'accounts') {
    if (!['accounts_pending', 'accounts_on_hold'].includes(request.status)) throw new Error('Request is not awaiting Accounts approval')
    if (input.action === 'reject') {
      updateData = { ...updateData, status: 'rejected', currentStage: 'accounts', rejectedAt: now, rejectedBy: appUser.id, accountsRemarks: input.remarks || null }
      newStatus = 'rejected'
    } else if (input.action === 'hold') {
      updateData = { ...updateData, status: 'accounts_on_hold', currentStage: 'accounts', accountsRemarks: input.remarks || null }
      newStatus = 'accounts_on_hold'
      newStage = 'accounts'
    } else {
      const approvedAmount = parseMoney(request.requestedAmount)

      return await db.transaction(async (tx) => {
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

        await tx.insert(pettyCashApprovalHistory).values({
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
        })

        if (input.action === 'approve') {
          void sendPettyCashApprovalEmail({
            requestNumber: request.requestNumber,
            requestedByName: request.requestedByName || 'User',
            requestedByEmail: request.requestedByEmail,
            createdByUserId: request.createdBy,
            requestedAmount: request.requestedAmount,
            allocatedAmount: approvedAmount,
            purpose: request.purpose,
            stage: input.stage,
            action: input.action,
            approvedByName: appUser.fullName,
            approvedByRole: appUser.role,
            newStatus: 'approved',
            remarks: input.remarks || null,
          })
        }

        return serializeRequest(updatedRequest)
      })
    }
  }

  const [updatedRequest] = await db
    .update(pettyCashRequests)
    .set(updateData)
    .where(and(eq(pettyCashRequests.id, request.id), eq(pettyCashRequests.status, request.status)))
    .returning()

  if (!updatedRequest) throw new Error('Request already moved to another stage')

  await db.insert(pettyCashApprovalHistory).values({
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
  })

  if (input.action === 'approve') {
    void sendPettyCashApprovalEmail({
      requestNumber: request.requestNumber,
      requestedByName: request.requestedByName || 'User',
      requestedByEmail: request.requestedByEmail,
      createdByUserId: request.createdBy,
      requestedAmount: request.requestedAmount,
      purpose: request.purpose,
      stage: input.stage,
      action: input.action,
      approvedByName: appUser.fullName,
      approvedByRole: appUser.role,
      newStatus,
      remarks: input.remarks || null,
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

  if (input.stage === 'ed_approval') {
    if (!['pending', 'ed_pending'].includes(expense.status)) throw new Error('Expense is not awaiting ED approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'ed_approved', currentStage: 'md_approval', edApprovedBy: appUser.id, edApprovedAt: now, edRemarks: input.remarks || null }
      newStatus = 'ed_approved'
      newStage = 'md_approval'
    } else {
      updateData = { ...updateData, status: 'ed_rejected', rejectedAt: now, rejectedBy: appUser.id, edRemarks: input.remarks || null }
      newStatus = 'ed_rejected'
    }
  } else if (input.stage === 'ea_approval') {
    if (!['pending', 'ed_approved'].includes(expense.status)) throw new Error('Expense is not awaiting EA approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'ea_approved', currentStage: 'md_approval', eaApprovedBy: appUser.id, eaApprovedAt: now, eaRemarks: input.remarks || null }
      newStatus = 'ea_approved'
      newStage = 'md_approval'
    } else {
      updateData = { ...updateData, status: 'ea_rejected', rejectedAt: now, rejectedBy: appUser.id, eaRemarks: input.remarks || null }
      newStatus = 'ea_rejected'
    }
  } else if (input.stage === 'md_approval') {
    if (!['ed_approved', 'ea_approved'].includes(expense.status)) throw new Error('Expense is not awaiting MD approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'accounts_pending', currentStage: 'accounts', mdApprovedBy: appUser.id, mdApprovedAt: now, mdRemarks: input.remarks || null }
      newStatus = 'accounts_pending'
      newStage = 'accounts'
    } else {
      updateData = { ...updateData, status: 'md_rejected', rejectedAt: now, rejectedBy: appUser.id, mdRemarks: input.remarks || null }
      newStatus = 'md_rejected'
    }
  } else if (input.stage === 'accounts') {
    if (expense.status !== 'accounts_pending') throw new Error('Expense is not awaiting Accounts approval')
    if (input.action === 'reject') {
      updateData = { ...updateData, status: 'rejected', rejectedAt: now, rejectedBy: appUser.id, accountsRemarks: input.remarks || null }
      newStatus = 'rejected'
    } else {
      const { updatedExpense } = await db.transaction(async (tx) => {
        const [updatedAllocation] = await tx
          .update(pettyCashAllocations)
          .set({
            spentAmount: sql`${pettyCashAllocations.spentAmount} + ${toMoney(expense.amount)}::numeric`,
            updatedAt: now,
          })
          .where(and(
            eq(pettyCashAllocations.id, expense.allocationId),
            eq(pettyCashAllocations.status, 'active')
          ))
          .returning()

        if (!updatedAllocation) throw new Error('Active petty cash allocation not found or updated')

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

        await tx.insert(pettyCashApprovalHistory).values({
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
        })

        return { updatedExpense }
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

  await db.insert(pettyCashApprovalHistory).values({
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
  })

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
    request: {
      ...serializeRequest(request),
      location: request.requestForm?.location ?? null,
      typeOfPayment: request.requestForm?.typeOfPayment ?? null,
    },
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
    // Surface the per-expense location (stored in expenseForm) so the detail drawer shows where
    // the money was spent; the list row's fallback covers legacy expenses without it.
    expense: { ...serializeExpense(expense), location: expense.expenseForm?.location ?? null },
    attachments,
    history: history.map((item) => ({
      ...serializeHistory(item),
      performedByName: userMap.get(item.performedBy)?.fullName || item.performedBy,
      performedByEmail: userMap.get(item.performedBy)?.email || null,
    })),
  }
}

export async function getPettyCashLedger(appUser: AppUser, allocationId?: string | null) {
  // A specific allocation → its ledger. Otherwise: all-branch supervisors
  // (EA/MD/EBA/Developer) see EVERY branch's movements; branch-scoped roles only
  // their own. The previous code filtered developers to branchId='all', which
  // matched nothing and left the ledger blank.
  const branchScoped = !hasPettyCashAllBranchAccess(appUser) && Boolean(appUser.brand) && appUser.brand !== 'all'
  const ledgerFilter = allocationId
    ? eq(pettyCashLedgerEntries.allocationId, allocationId)
    : branchScoped
      ? eq(pettyCashLedgerEntries.branchId, appUser.brand as string)
      : undefined

  // Location is derived like the Expenses/Allocations feeds: prefer the expense's own location
  // (for expense entries), else the originating request's location (via allocation → request).
  // This lets the Ledger tab filter by location without a dedicated column.
  const rows = await db
    .select({
      ledger: pettyCashLedgerEntries,
      location: sql<string | null>`COALESCE(${pettyCashExpenses.expenseForm} ->> 'location', ${pettyCashRequests.requestForm} ->> 'location')`,
    })
    .from(pettyCashLedgerEntries)
    .leftJoin(pettyCashAllocations, eq(pettyCashAllocations.id, pettyCashLedgerEntries.allocationId))
    .leftJoin(pettyCashRequests, eq(pettyCashRequests.id, pettyCashAllocations.requestId))
    .leftJoin(pettyCashExpenses, eq(pettyCashExpenses.id, pettyCashLedgerEntries.expenseId))
    .where(ledgerFilter)
    .orderBy(desc(pettyCashLedgerEntries.createdAt))
    .limit(100)

  return rows.map((row) => ({ ...serializeLedger(row.ledger as Record<string, unknown>), location: row.location || null }))
}

export async function deletePettyCashRequest(appUser: AppUser, requestId: string) {
  const [existing] = await db.select().from(pettyCashRequests).where(eq(pettyCashRequests.id, requestId)).limit(1)
  if (!existing) throw new Error('Petty cash request not found')

  // Rule 1: Only pending requests can be deleted
  const isPending = existing.status === 'draft' || existing.status === 'ed_pending' || existing.status === 'ea_pending' || existing.status === 'md_pending' || existing.status === 'accounts_pending'
  if (!isPending) {
    throw new Error('Only pending requests can be deleted.')
  }

  // Rule 2: Only the user who submitted the request can delete it (super admin / developer allowed)
  const isSubmitter = existing.createdBy === appUser.id ||
    (Boolean(existing.requestedByEmail) && Boolean(appUser.email) && String(existing.requestedByEmail).toLowerCase() === String(appUser.email).toLowerCase()) ||
    (Boolean(existing.requestedByName) && Boolean(appUser.fullName) && String(existing.requestedByName).toLowerCase() === String(appUser.fullName).toLowerCase())
  const isDeveloperOrAdmin = (appUser.role as string) === 'developer' || (appUser.role as string) === 'super_admin'

  if (!isSubmitter && !isDeveloperOrAdmin) {
    throw new Error('Only the user who submitted this request can delete it.')
  }

  await db.transaction(async (tx) => {
    const [alloc] = await tx.select({ id: pettyCashAllocations.id }).from(pettyCashAllocations).where(eq(pettyCashAllocations.requestId, requestId)).limit(1)
    if (alloc) {
      await tx.delete(pettyCashLedgerEntries).where(eq(pettyCashLedgerEntries.allocationId, alloc.id))
      await tx.delete(pettyCashExpenses).where(eq(pettyCashExpenses.allocationId, alloc.id))
      await tx.delete(pettyCashAllocations).where(eq(pettyCashAllocations.id, alloc.id))
    }
    await tx.delete(pettyCashRequests).where(eq(pettyCashRequests.id, requestId))
  })
  return { ok: true }
}

/**
 * ⚠️ This had NO authorization of any kind. The route only verified that a session existed — not the
 * role, not the branch, not ownership — so any authenticated user in the company could delete any
 * expense in any branch by id, together with its ledger entries, by calling
 * DELETE /api/petty-cash/expenses/<id> directly.
 *
 * The rules below mirror deletePettyCashRequest: still-pending only, and the person who posted it
 * only (developer / super_admin excepted), with the branch visibility rule applied first so a user
 * cannot even address a row they are not allowed to see.
 */
export async function deletePettyCashExpense(appUser: AppUser, expenseId: string) {
  if (!canAccessPettyCash(appUser.role)) throw new Error('Forbidden')

  const [existing] = await db.select().from(pettyCashExpenses).where(eq(pettyCashExpenses.id, expenseId)).limit(1)
  if (!existing) throw new Error('Petty cash expense not found')

  // Same visibility boundary the read path uses — no cross-branch reach.
  if (!canReadPettyCashExpense(appUser, existing)) throw new Error('Forbidden')

  // The line that matters is the LEDGER, not the workflow stage. A finally-approved expense has moved
  // the float's balance and been posted, so removing it would silently rewrite a reconciled cash
  // position. Anything still in flight (pending, mid-approval, rejected) has not, and a wrong entry
  // should be correctable — blocking those too would have made this path dead for every real row.
  if (existing.status === 'approved') {
    throw new Error('An approved expense cannot be deleted — it has already been posted to the ledger.')
  }

  const role = String(appUser.role || '').trim().toLowerCase()
  const isSuperUser = role === 'developer' || role === 'super_admin'
  if (!isSuperUser && existing.createdBy !== appUser.id) {
    throw new Error('Only the user who posted this expense can delete it.')
  }

  await db.transaction(async (tx) => {
    await tx.delete(pettyCashLedgerEntries).where(eq(pettyCashLedgerEntries.expenseId, expenseId))
    await tx.delete(pettyCashExpenses).where(eq(pettyCashExpenses.id, expenseId))
  })
  return { ok: true }
}
