import { and, eq, isNull } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess } from '@/lib/branches'
import { pettyCashAllocations, pettyCashExpenses, pettyCashRequests } from '@/lib/db/schema'

type PettyCashRole = AppUser['role']
type PettyCashRequestRecord = typeof pettyCashRequests.$inferSelect
type PettyCashExpenseRecord = typeof pettyCashExpenses.$inferSelect
type PettyCashAllocationRecord = typeof pettyCashAllocations.$inferSelect

export function canAccessPettyCash(role: PettyCashRole | null | undefined) {
  return role === 'admin'
    || role === 'super_admin'
    || role === 'branch_admin'
    || role === 'ea'
    || role === 'md'
    || role === 'eba'
    || role === 'accounts'
}

// Only the Branch Admin (branch_admin) submits petty cash requests and expenses.
// Everyone else in the chain (EA, MD/EBA, Accounts, super_admin) reviews/approves.
export function canCreatePettyCashRequest(role: PettyCashRole | null | undefined) {
  return role === 'branch_admin'
}

export function canCreatePettyCashExpense(role: PettyCashRole | null | undefined) {
  return role === 'branch_admin'
}

export function canApprovePettyCashStage(role: PettyCashRole | null | undefined, stage: string) {
  // Super admin is a universal supervisor and may act on any stage.
  if (role === 'super_admin') return true
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

  if (appUser.role === 'super_admin' || hasAllBranchAccess(appUser.brand)) {
    return and(...baseFilters)!
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin') {
    return and(...baseFilters, eq(pettyCashRequests.branchId, appUser.brand || ''))!
  }

  if (appUser.role === 'md' || appUser.role === 'eba') {
    return and(...baseFilters)!
  }

  if (appUser.role === 'ea' || appUser.role === 'accounts') {
    return and(...baseFilters, eq(pettyCashRequests.branchId, appUser.brand || ''))!
  }

  return and(...baseFilters, eq(pettyCashRequests.createdBy, appUser.id))!
}

export function getPettyCashExpenseVisibilityFilter(appUser: AppUser): SQL<unknown> {
  const baseFilters: SQL<unknown>[] = [isNull(pettyCashExpenses.deletedAt)]

  if (appUser.role === 'super_admin' || hasAllBranchAccess(appUser.brand)) {
    return and(...baseFilters)!
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin') {
    return and(...baseFilters, eq(pettyCashExpenses.branchId, appUser.brand || ''))!
  }

  if (appUser.role === 'ea' || appUser.role === 'md' || appUser.role === 'eba' || appUser.role === 'accounts') {
    return and(...baseFilters, eq(pettyCashExpenses.branchId, appUser.brand || ''))!
  }

  return and(...baseFilters, eq(pettyCashExpenses.createdBy, appUser.id))!
}

export function getPettyCashAllocationVisibilityFilter(appUser: AppUser): SQL<unknown> {
  if (appUser.role === 'super_admin' || hasAllBranchAccess(appUser.brand)) {
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
  if (appUser.role === 'super_admin' || hasAllBranchAccess(appUser.brand)) return true
  if (appUser.role === 'md' || appUser.role === 'eba') return true
  if (request.createdBy === appUser.id) return true
  return canAccessPettyCash(appUser.role) && appUser.brand === request.branchId
}

export function canReadPettyCashExpense(appUser: AppUser, expense: Pick<PettyCashExpenseRecord, 'branchId' | 'createdBy'>) {
  if (appUser.role === 'super_admin' || hasAllBranchAccess(appUser.brand)) return true
  if (expense.createdBy === appUser.id) return true
  return canAccessPettyCash(appUser.role) && appUser.brand === expense.branchId
}

export function canUsePettyCashAllocation(appUser: AppUser, allocation: Pick<PettyCashAllocationRecord, 'branchId' | 'allocatedTo' | 'status'>) {
  if (allocation.status !== 'active') return false
  return allocation.allocatedTo === appUser.id && appUser.brand === allocation.branchId
}
