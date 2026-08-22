import 'server-only'

import type { AppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { parseUserDealers } from '@/lib/dealers/registry'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { hasAllBranchAccess, type BranchValue } from '@/lib/branches'

/**
 * Who may see, act on, or export a given approval request.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * The rule lived inline in the LIST route and nowhere else, so it governed what appeared on screen
 * and nothing more. `export-tally`, `bulk-action`, `[id]/action` and `[id]/remark` carried no branch
 * check at all — a user scoped to one branch could approve, reject, remark on or export another
 * branch's payment request simply by holding its id. Scoping a list without scoping the writes it
 * links to is not scoping.
 *
 * Every approvals route now resolves visibility here, so the read and the write cannot disagree.
 */

/** The shape both the list query and the single-row lookups produce. */
export type ApprovalScopeRow = {
  brand: string | null
  dealerCode: string | null
  location?: string | null
}

/**
 * Users who see every branch. Deliberately just two things:
 *
 *   1. MD and developer — {@link isSuperAdminRole}.
 *   2. Anyone explicitly granted "All Branches" in Admin — that IS multi-branch access.
 *
 * ⚠️ `hasGlobalAccessRole` is NOT used here, and must not be reintroduced. It covers nine roles
 * (developer, md, ceo, ea, eba, ed, edp, process_coordinator, hr) and every one of them silently
 * saw every branch's payment requests. Approvals carry vendor names and amounts — ₹2.58 Cr across
 * 123 requests at the time of writing — so "can reach this section" and "may see the whole group's
 * money" are different questions, and this function answers only the second.
 *
 * ⚠️ FAIL CLOSED, and that has an operational cost: a user with no dealer pin resolves to no
 * branch, so they see nothing. 39 of 62 active users were unpinned when this shipped, including
 * all 5 accounts, all 4 ea and all 3 branch_admin — roles that are approval STAGES here. They
 * cannot action anything until an admin sets their branch (or grants All Branches). That is the
 * intended trade: an empty section is a visible problem someone reports in a minute, whereas a
 * silently over-wide one is not.
 */
export function canSeeAllApprovals(appUser: AppUser | null): boolean {
  if (!appUser) return false
  return isSuperAdminRole(appUser.role) || hasAllBranchAccess(appUser.brand)
}

/**
 * True when `appUser` may see this request.
 *
 * Two gates, both of which must pass for a scoped user:
 *   1. BRAND — a Hyundai request is not visible to a KIA-only user. Rows default to 'kia' because
 *      the column post-dates the first 122 requests.
 *   2. DEALER BRANCH — JK402 / JK501 / JK502.
 *
 * ⚠️ A row with no dealer code fails CLOSED for scoped users. It previously passed for everyone:
 * the check read `if (row.dealerCode && !canAccessDealer(...)) return false`, so a blank code
 * skipped the branch gate entirely and the request was visible company-wide. One such row exists
 * today; a submitter who leaves the field empty should not be able to broadcast a payment request.
 */
export function isApprovalVisibleTo(appUser: AppUser | null, row: ApprovalScopeRow): boolean {
  if (!appUser) return false
  if (canSeeAllApprovals(appUser)) return true

  const rowBrand = (row.brand || 'kia').toLowerCase() as BranchValue
  if (!canAccessBrand(appUser, rowBrand)) return false

  /*
   * `dealer_code` is not reliably a code — one live row holds the literal 'JAMMU' rather than
   * JK402 — so `location` is accepted as an alternative match. Either identifying the row's branch
   * is enough; neither present means the row cannot be placed, and an unplaceable row is hidden.
   */
  const code = String(row.dealerCode || '').trim()
  const location = String(row.location || '').trim()
  if (!code && !location) return false

  /*
   * ⚠️ Deliberately NOT lib/auth/dealer-scope.ts#canAccessDealer.
   *
   * That helper resolves through getUserDealerScope, which returns "unrestricted" in two cases this
   * section must refuse: any of the nine global-access roles, and — the big one — ANY user with no
   * dealer pin at all (`if (!hasPin) return null`). 39 of 62 active users are unpinned, so reusing
   * it would leave the branch gate wide open while looking closed.
   *
   * Changing getUserDealerScope itself is not an option: every Business Excellence and booking route
   * depends on its lenient-when-unpinned behaviour. So the pin is read directly here, and an empty
   * pin denies. Approvals is stricter than the rest of the app on purpose.
   */
  const pinned = parseUserDealers(rowBrand, appUser.dealers)
  if (!pinned.length) return false

  const allowed = new Set(pinned.map((c) => c.trim().toUpperCase()))
  return allowed.has(code.toUpperCase()) || allowed.has(location.toUpperCase())
}

/** Filter a page of requests down to the ones `appUser` may see. */
export function filterVisibleApprovals<T extends ApprovalScopeRow>(appUser: AppUser | null, rows: T[]): T[] {
  if (canSeeAllApprovals(appUser)) return rows
  return rows.filter((row) => isApprovalVisibleTo(appUser, row))
}
