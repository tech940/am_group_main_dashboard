import { and, eq, isNull } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess } from '@/lib/branches'
import { pettyCashAllocations, pettyCashExpenses, pettyCashRequests } from '@/lib/db/schema'
import { isPettyCashViewRole } from '@/lib/permissions/legacy-module-roles'

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
const PETTY_CASH_ALL_BRANCH_ROLES = new Set<string>(['developer', 'ea', 'md', 'eba'])

export function hasPettyCashAllBranchAccess(appUser: Pick<AppUser, 'role' | 'brand'>) {
  return PETTY_CASH_ALL_BRANCH_ROLES.has(appUser.role) || hasAllBranchAccess(appUser.brand)
}

/** May this user VIEW petty-cash data scoped to `branchId`? All-branch roles may
 * scope to any brand; everyone else only to their own. Distinct from
 * canManagePettyCashBranch, which governs CREATE (kept branch-strict). */
export function canViewPettyCashBranch(appUser: AppUser, branchId: string | null | undefined) {
  if (!branchId) return false
  return hasPettyCashAllBranchAccess(appUser) || appUser.brand === branchId
}

// Only the Branch Admin (branch_admin) submits petty cash requests and expenses.
// Everyone else in the chain (EA, MD/EBA, Accounts, developer) reviews/approves.
export function canCreatePettyCashRequest(role: PettyCashRole | null | undefined) {
  return role === 'branch_admin'
}

export function canCreatePettyCashExpense(role: PettyCashRole | null | undefined) {
  return role === 'branch_admin'
}

export function canApprovePettyCashStage(role: PettyCashRole | null | undefined, stage: string) {
  // Super admin is a universal supervisor and may act on any stage.
  if (role === 'developer' || role === 'manager' || role === 'general_manager') return true
  switch (stage) {
    case 'ea_approval':
      return role === 'ea'
    case 'md_approval':
      return role === 'md' || role === 'eba'
    case 'accounts':
      return role === 'accounts'
    default:
      return false
  }
}

export function canManagePettyCashBranch(appUser: AppUser, branchId: string | null | undefined) {
  if (!branchId) return false
  if (hasAllBranchAccess(appUser.brand)) return true
  return appUser.brand === branchId
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
    return and(...baseFilters, eq(pettyCashRequests.branchId, appUser.brand || ''))!
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
    return and(...baseFilters, eq(pettyCashExpenses.branchId, appUser.brand || ''))!
  }

  return and(...baseFilters, eq(pettyCashExpenses.createdBy, appUser.id))!
}

export function getPettyCashAllocationVisibilityFilter(appUser: AppUser): SQL<unknown> {
  // EA / MD / EBA / Developer (and any 'all' user) see every branch's allocations.
  if (hasPettyCashAllBranchAccess(appUser)) {
    return eq(pettyCashAllocations.status, 'active')
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin') {
    return and(
      eq(pettyCashAllocations.status, 'active'),
      eq(pettyCashAllocations.allocatedTo, appUser.id),
      eq(pettyCashAllocations.branchId, appUser.brand || '')
    )!
  }

  return and(
    eq(pettyCashAllocations.status, 'active'),
    eq(pettyCashAllocations.branchId, appUser.brand || '')
  )!
}

export function canReadPettyCashRequest(appUser: AppUser, request: Pick<PettyCashRequestRecord, 'branchId' | 'createdBy'>) {
  if (hasPettyCashAllBranchAccess(appUser)) return true
  if (request.createdBy === appUser.id) return true
  return canAccessPettyCash(appUser.role) && appUser.brand === request.branchId
}

export function canReadPettyCashExpense(appUser: AppUser, expense: Pick<PettyCashExpenseRecord, 'branchId' | 'createdBy'>) {
  if (hasPettyCashAllBranchAccess(appUser)) return true
  if (expense.createdBy === appUser.id) return true
  return canAccessPettyCash(appUser.role) && appUser.brand === expense.branchId
}

export function canUsePettyCashAllocation(appUser: AppUser, allocation: Pick<PettyCashAllocationRecord, 'branchId' | 'allocatedTo' | 'status'>) {
  if (allocation.status !== 'active') return false
  return allocation.allocatedTo === appUser.id && appUser.brand === allocation.branchId
}
