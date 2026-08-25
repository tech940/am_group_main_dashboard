import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess, isBranchValue } from '@/lib/branches'
import { pettyCashAllocations, pettyCashExpenses, pettyCashRequests } from '@/lib/db/schema'
import { isPettyCashViewRole } from '@/lib/permissions/legacy-module-roles'
import { defaultBranchScopeFor } from '@/lib/auth/default-branch-scope'
import { getPettyCashUserBrands, isPettyCashAllBranchRole, isPettyCashOwnSubmissionsOnlyRole } from './constants'

type PettyCashRole = AppUser['role']
type PettyCashRequestRecord = typeof pettyCashRequests.$inferSelect
type PettyCashExpenseRecord = typeof pettyCashExpenses.$inferSelect
type PettyCashAllocationRecord = typeof pettyCashAllocations.$inferSelect

// Shared with the sidebar so the link and the page guard can never drift. See legacy-module-roles.ts.
export function canAccessPettyCash(role: PettyCashRole | null | undefined) {
  return isPettyCashViewRole(role)
}

/**
 * Unconditional all-branch supervision is now MD + Developer ONLY (the list lives in
 * ./constants.ts so the client shares it). Every other role — INCLUDING EA, EBA and ED — sees
 * exactly the branches their admin-panel assignment grants: `users.brand` of 'kia' means KIA only,
 * 'kia,hyundai' means both, and 'all' still opens everything via hasAllBranchAccess. The
 * assignment, not the role, is the lever.
 */
export function hasPettyCashAllBranchAccess(appUser: Pick<AppUser, 'role' | 'brand'>) {
  return isPettyCashAllBranchRole(appUser.role) || hasAllBranchAccess(appUser.brand)
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

export function canCreatePettyCashRequest(role: PettyCashRole | null | undefined) {
  const r = String(role || '').trim().toLowerCase()
  return (
    r === 'branch_admin' ||
    r === 'sales_manager' ||
    r === 'developer' ||
    r === 'admin' ||
    r === 'manager' ||
    r === 'general_manager' ||
    r === 'md' ||
    r === 'accounts' ||
    r === 'ea' ||
    r === 'eba' ||
    r === 'ed'
  )
}

export function canCreatePettyCashExpense(role: PettyCashRole | null | undefined) {
  const r = String(role || '').trim().toLowerCase()
  return (
    r === 'branch_admin' ||
    r === 'sales_manager' ||
    r === 'developer' ||
    r === 'admin' ||
    r === 'manager' ||
    r === 'general_manager' ||
    r === 'md' ||
    r === 'accounts' ||
    r === 'ea' ||
    r === 'eba' ||
    r === 'ed'
  )
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
  if (hasPettyCashAllBranchAccess(appUser) || hasAllBranchAccess(appUser.brand)) return true
  return brandsOf(appUser).includes(branchId)
}

/**
 * The branch predicate for a request, honouring the caller's choice OR falling back to the login's
 * own assignment.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * The visibility filters above are the PERMISSION boundary — an all-branch role passes them
 * unrestricted, which is correct: an MD may look at any branch. But "may look at any" was silently
 * doing duty as "lands on all", so an MD pinned to KIA opened on group-wide numbers unless the
 * browser happened to send ?branchId=. This supplies the missing DEFAULT, server-side.
 *
 * Returns `undefined` for "no narrowing" (an explicit 'all', or a login with no meaningful default).
 *
 * ⚠️ Still not a boundary: an explicitly requested branch is validated with canViewPettyCashBranch
 * and rejected if not permitted, but the FALLBACK is never rejected — it is only a starting view.
 */
export function pettyCashRequestedBranchScope<T extends PgColumn>(
  appUser: AppUser,
  column: T,
  branchId: string | null | undefined,
): SQL<unknown> | undefined {
  const asked = String(branchId || '').trim().toLowerCase()

  // An explicit choice wins, and must be one this login may actually view.
  if (asked && asked !== 'all') {
    const picked = asked.split(',').map((v) => v.trim()).filter(Boolean)
    for (const value of picked) {
      if (!isBranchValue(value)) throw new Error('Invalid branch')
      if (!canViewPettyCashBranch(appUser, value)) throw new Error('Forbidden branch')
    }
    return picked.length === 1 ? eq(column, picked[0]) : inArray(column, picked)
  }
  // Explicit 'all' means the user deliberately widened — no narrowing.
  if (asked === 'all') return undefined

  // Nothing asked: fall back to this login's own branches.
  const scope = defaultBranchScopeFor(appUser.brand)
  if (scope === 'all') return undefined
  const usable = scope.filter((value) => isBranchValue(value))
  if (!usable.length) return undefined
  return usable.length === 1 ? eq(column, usable[0]) : inArray(column, usable)
}

export function getPettyCashRequestVisibilityFilter(appUser: AppUser): SQL<unknown> {
  const baseFilters: SQL<unknown>[] = [isNull(pettyCashRequests.deletedAt)]

  // MD / Developer (and any user ASSIGNED 'all' in the admin panel) see every branch's requests.
  if (hasPettyCashAllBranchAccess(appUser)) {
    return and(...baseFilters)!
  }

  /*
   * SUBMITTERS (branch_admin / sales_manager) see ONLY THEIR OWN requests. They are custodians of
   * their own float, not supervisors of the branch — three KIA branch admins used to see each
   * other's submissions because they shared a brand. Branch scope is kept alongside the ownership
   * test as defence in depth, so a row mis-tagged to another brand cannot surface either.
   */
  if (isPettyCashOwnSubmissionsOnlyRole(appUser.role)) {
    return and(
      ...baseFilters,
      pettyCashBranchScope(pettyCashRequests.branchId, brandsOf(appUser)),
      eq(pettyCashRequests.createdBy, appUser.id),
    )!
  }

  if (
    appUser.role === 'admin' ||
    appUser.role === 'accounts' ||
    appUser.role === 'manager' ||
    appUser.role === 'general_manager' ||
    // Approver roles, brand-scoped by ASSIGNMENT since they left the all-branch list. Without this
    // arm they would fall through to the createdBy-only fallback below and — as reviewers who never
    // create requests — see an empty queue.
    appUser.role === 'ea' ||
    appUser.role === 'eba' ||
    appUser.role === 'ed'
  ) {
    return and(...baseFilters, pettyCashBranchScope(pettyCashRequests.branchId, brandsOf(appUser)))!
  }

  return and(...baseFilters, eq(pettyCashRequests.createdBy, appUser.id))!
}

export function getPettyCashExpenseVisibilityFilter(appUser: AppUser): SQL<unknown> {
  const baseFilters: SQL<unknown>[] = [isNull(pettyCashExpenses.deletedAt)]

  // MD / Developer (and any user ASSIGNED 'all') see every branch's expenses.
  if (hasPettyCashAllBranchAccess(appUser)) {
    return and(...baseFilters)!
  }

  // Submitters see only their own spends — see the request filter above for why.
  if (isPettyCashOwnSubmissionsOnlyRole(appUser.role)) {
    return and(
      ...baseFilters,
      pettyCashBranchScope(pettyCashExpenses.branchId, brandsOf(appUser)),
      eq(pettyCashExpenses.createdBy, appUser.id),
    )!
  }

  if (
    appUser.role === 'admin' ||
    appUser.role === 'accounts' ||
    appUser.role === 'manager' ||
    appUser.role === 'general_manager' ||
    // Same as the request filter above: assignment-scoped approvers, not createdBy-only.
    appUser.role === 'ea' ||
    appUser.role === 'eba' ||
    appUser.role === 'ed'
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

  // MD / Developer (and any user ASSIGNED 'all') see every branch's allocations.
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

/*
 * ⚠️ The by-id reads must agree with the list filters above, or a submitter who cannot SEE another
 * admin's row in the list could still OPEN it by guessing the id. Hence the explicit submitter
 * check before the brand fallback.
 */
export function canReadPettyCashRequest(appUser: AppUser, request: Pick<PettyCashRequestRecord, 'branchId' | 'createdBy'>) {
  if (hasPettyCashAllBranchAccess(appUser)) return true
  if (request.createdBy === appUser.id) return true
  if (isPettyCashOwnSubmissionsOnlyRole(appUser.role)) return false
  return canAccessPettyCash(appUser.role) && brandsOf(appUser).includes(request.branchId)
}

export function canReadPettyCashExpense(appUser: AppUser, expense: Pick<PettyCashExpenseRecord, 'branchId' | 'createdBy'>) {
  if (hasPettyCashAllBranchAccess(appUser)) return true
  if (expense.createdBy === appUser.id) return true
  if (isPettyCashOwnSubmissionsOnlyRole(appUser.role)) return false
  return canAccessPettyCash(appUser.role) && brandsOf(appUser).includes(expense.branchId)
}

export function canUsePettyCashAllocation(appUser: AppUser, allocation: Pick<PettyCashAllocationRecord, 'branchId' | 'allocatedTo' | 'status'>) {
  if (allocation.status !== 'active') return false
  return allocation.allocatedTo === appUser.id && brandsOf(appUser).includes(allocation.branchId)
}
