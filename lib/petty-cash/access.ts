import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess } from '@/lib/branches'
import { pettyCashAllocations, pettyCashExpenses, pettyCashRequests } from '@/lib/db/schema'
import { isPettyCashViewRole } from '@/lib/permissions/legacy-module-roles'
import { getPettyCashUserBrands } from './constants'

type PettyCashRole = AppUser['role']
type PettyCashRequestRecord = typeof pettyCashRequests.$inferSelect
type PettyCashExpenseRecord = typeof pettyCashExpenses.$inferSelect
type PettyCashAllocationRecord = typeof pettyCashAllocations.$inferSelect

// Shared with the sidebar so the link and the page guard can never drift. See legacy-module-roles.ts.
export function canAccessPettyCash(role: PettyCashRole | null | undefined) {
  return isPettyCashViewRole(role)
}

// Org-level roles that supervise petty cash across the WHOLE system. In petty
// cash `branchId` is the brand (e.g. 'kia') and the individual dealership
// (JK402 = KIA Jammu, JK501 = KIA Udhampur, …) lives in requestForm.location —
// so "all branches" here means every brand AND every dealership. These roles are
// not tied to a single branch and must see requests, expenses and allocations
// everywhere. (MD/EBA already had this for requests; EA + expenses + allocations
// were inconsistently branch-scoped — this makes it uniform.)
const PETTY_CASH_ALL_BRANCH_ROLES = new Set<string>(['developer', 'ea', 'md', 'eba', 'ed'])

export function hasPettyCashAllBranchAccess(appUser: Pick<AppUser, 'role' | 'brand'>) {
  return PETTY_CASH_ALL_BRANCH_ROLES.has(appUser.role) || hasAllBranchAccess(appUser.brand)
}

/**
 * `branch_id = <brand>` for the single-brand login almost everybody is, `branch_id IN (…)` only
 * when the login genuinely covers two.
 *
 * The one-brand arm emits byte-for-byte the same predicate and the same bound parameter as the old
 * `eq(col, appUser.brand || '')`, so no live query plan changes and
 * petty_cash_allocations_branch_status_created_idx is still used.
 *
 * The zero-brand arm keeps the old `= ''` (matches nothing) rather than relying on drizzle folding
 * an empty inArray into FALSE. This predicate is the only thing between a mis-pinned or unpinned
 * user and every branch's cash, so it fails CLOSED explicitly rather than incidentally.
 */
export function pettyCashBranchScope<T extends PgColumn>(column: T, brands: string[]): SQL<unknown> {
  if (brands.length === 0) return eq(column, '')
  if (brands.length === 1) return eq(column, brands[0])
  return inArray(column, brands)
}

/** Brands this login may act in. Empty for 'all'/null pins — ask hasPettyCashAllBranchAccess first. */
function brandsOf(appUser: Pick<AppUser, 'brand'>) {
  return getPettyCashUserBrands(appUser.brand)
}

/** May this user VIEW petty-cash data scoped to `branchId`? All-branch roles may
 * scope to any brand; everyone else only to their own. Distinct from
 * canManagePettyCashBranch, which governs CREATE (kept branch-strict). */
export function canViewPettyCashBranch(appUser: AppUser, branchId: string | null | undefined) {
  if (!branchId) return false
  return hasPettyCashAllBranchAccess(appUser) || brandsOf(appUser).includes(branchId)
}

// Only the Branch Admin (branch_admin) or Sales Manager (sales_manager) submits petty cash requests and expenses.
// Everyone else in the chain (EA, MD/EBA, Accounts, developer) reviews/approves.
export function canCreatePettyCashRequest(role: PettyCashRole | null | undefined) {
  return role === 'branch_admin' || role === 'sales_manager'
}

export function canCreatePettyCashExpense(role: PettyCashRole | null | undefined) {
  return role === 'branch_admin' || role === 'sales_manager'
}

export function canApprovePettyCashStage(role: PettyCashRole | null | undefined, stage: string) {
  if (!role) return false
  const r = String(role).trim().toLowerCase()
  if (r === 'developer' || r === 'admin') return true

  const isAccounts = r === 'accounts' || r === 'accounts_head' || r === 'accounts_team' || r === 'finance_head' || r === 'finance_team'

  switch (stage) {
    case 'ed_approval':
      return r === 'ed'
    case 'ea_approval':
      return r === 'ea'
    case 'md_approval':
      return r === 'md' || r === 'eba'
    case 'accounts':
      return isAccounts
    default:
      return false
  }
}

export function canManagePettyCashBranch(appUser: AppUser, branchId: string | null | undefined) {
  if (!branchId) return false
  if (hasAllBranchAccess(appUser.brand)) return true
  return brandsOf(appUser).includes(branchId)
}

export function getPettyCashRequestVisibilityFilter(appUser: AppUser): SQL<unknown> {
  const baseFilters: SQL<unknown>[] = [isNull(pettyCashRequests.deletedAt)]

  // EA / MD / EBA / Developer (and any 'all' user) see every branch's requests.
  if (hasPettyCashAllBranchAccess(appUser)) {
    return and(...baseFilters)!
  }

  if (
    appUser.role === 'admin' ||
    appUser.role === 'branch_admin' ||
    appUser.role === 'accounts' ||
    appUser.role === 'manager' ||
    appUser.role === 'general_manager' ||
    appUser.role === 'sales_manager'
  ) {
    return and(...baseFilters, pettyCashBranchScope(pettyCashRequests.branchId, brandsOf(appUser)))!
  }

  return and(...baseFilters, eq(pettyCashRequests.createdBy, appUser.id))!
}

export function getPettyCashExpenseVisibilityFilter(appUser: AppUser): SQL<unknown> {
  const baseFilters: SQL<unknown>[] = [isNull(pettyCashExpenses.deletedAt)]

  // EA / MD / EBA / Developer (and any 'all' user) see every branch's expenses.
  if (hasPettyCashAllBranchAccess(appUser)) {
    return and(...baseFilters)!
  }

  if (
    appUser.role === 'admin' ||
    appUser.role === 'branch_admin' ||
    appUser.role === 'accounts' ||
    appUser.role === 'manager' ||
    appUser.role === 'general_manager' ||
    appUser.role === 'sales_manager'
  ) {
    return and(...baseFilters, pettyCashBranchScope(pettyCashExpenses.branchId, brandsOf(appUser)))!
  }

  return and(...baseFilters, eq(pettyCashExpenses.createdBy, appUser.id))!
}

/**
 * `includeInactive` widens the filter to closed/cancelled allocations as well.
 *
 * ⚠️ It defaults to FALSE and must stay that way. getCurrentPettyCashAllocation relies on this
 * helper returning only the ONE open allocation (the schema enforces one active row per
 * branch+recipient); letting closed rows through there would make "your current balance" pick an
 * arbitrary historical float. Only the allocation HISTORY list passes true — without it there is no
 * history at all to show, because every past allocation is closed.
 */
export function getPettyCashAllocationVisibilityFilter(
  appUser: AppUser,
  options?: { includeInactive?: boolean },
): SQL<unknown> {
  const activeOnly = options?.includeInactive
    ? []
    : [eq(pettyCashAllocations.status, 'active')]

  // EA / MD / EBA / Developer (and any 'all' user) see every branch's allocations.
  if (hasPettyCashAllBranchAccess(appUser)) {
    // `and()` of an empty list is undefined, so a lone TRUE keeps the return type honest when the
    // status predicate is dropped and no other predicate applies to this role.
    return and(...activeOnly, sql`true`)!
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin' || appUser.role === 'sales_manager') {
    return and(
      ...activeOnly,
      eq(pettyCashAllocations.allocatedTo, appUser.id),
      pettyCashBranchScope(pettyCashAllocations.branchId, brandsOf(appUser))
    )!
  }

  return and(
    ...activeOnly,
    pettyCashBranchScope(pettyCashAllocations.branchId, brandsOf(appUser))
  )!
}

export function canReadPettyCashRequest(appUser: AppUser, request: Pick<PettyCashRequestRecord, 'branchId' | 'createdBy'>) {
  if (hasPettyCashAllBranchAccess(appUser)) return true
  if (request.createdBy === appUser.id) return true
  return canAccessPettyCash(appUser.role) && brandsOf(appUser).includes(request.branchId)
}

export function canReadPettyCashExpense(appUser: AppUser, expense: Pick<PettyCashExpenseRecord, 'branchId' | 'createdBy'>) {
  if (hasPettyCashAllBranchAccess(appUser)) return true
  if (expense.createdBy === appUser.id) return true
  return canAccessPettyCash(appUser.role) && brandsOf(appUser).includes(expense.branchId)
}

export function canUsePettyCashAllocation(appUser: AppUser, allocation: Pick<PettyCashAllocationRecord, 'branchId' | 'allocatedTo' | 'status'>) {
  if (allocation.status !== 'active') return false
  return allocation.allocatedTo === appUser.id && brandsOf(appUser).includes(allocation.branchId)
}
