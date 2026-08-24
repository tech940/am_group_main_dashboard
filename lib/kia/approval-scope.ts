import 'server-only'

import type { AppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { parseUserDealers } from '@/lib/dealers/registry'
import { approvalBranchTokens } from '@/lib/kia/approval-branches'
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
 * Branch tokens an approvals user may be pinned to, for one brand.
 *
 * ── Why this is not just parseUserDealers ─────────────────────────────────────────────────────
 * parseUserDealers filters a pin against the brand's DMS dealer registry, and some branches that
 * genuinely submit payment requests are not in it. BANIHAL is the live example: the approvals form
 * offers it as a location (LOCATION_OPTIONS in features/kia/kia-approvals-page.tsx) and 7 requests
 * worth ~Rs12.5L are filed against dealer_code 'JK502', but KIA_BRANCH_DEALERS holds only JK402 and
 * JK501. So parseUserDealers silently dropped 'JK502' from any pin, and NO pin could reach those
 * rows — they were visible only to all-branch users. A branch nobody can be scoped to is a branch
 * whose own staff cannot see their own requests.
 *
 * Fixing it in KIA_BRANCH_DEALERS was the wrong lever: that registry feeds the sales, stock and
 * Business Excellence dealer pickers, where Banihal has no DMS data at all and would appear as a
 * permanently empty branch. Petty Cash hit exactly this and solved it the same way — see
 * `extraLocations: ['Banihal']` in lib/petty-cash/constants.ts. This is that pattern, scoped to
 * approvals so the blast radius stays here.
 *
 * ⚠️ These are ADDITIVE and must stay narrow. Every token added here becomes grantable, so it must
 * correspond to a real branch that really submits approvals — never a convenience alias.
 */
function resolveApprovalBranchPins(rowBrand: string, dealers: string | null | undefined): Set<string> {
  const registered = parseUserDealers(rowBrand, dealers).map((code) => code.trim().toUpperCase())
  const allowed = new Set(registered)

  // Admit approval-only tokens the DMS registry does not carry, but ONLY when the user was actually
  // pinned to them — this widens what a pin can express, never what an unpinned user can see.
  const extras = approvalBranchTokens(rowBrand)
  if (extras.length) {
    const pins = String(dealers || '').split(',').map((v) => v.trim().toUpperCase()).filter(Boolean)
    for (const extra of extras) {
      if (pins.includes(extra.toUpperCase())) {
        // A pin on either token opens both, so 'JK502' and 'BANIHAL' are interchangeable in a pin
        // and a row identified by either code or location still matches.
        for (const token of extras) allowed.add(token.toUpperCase())
      }
    }
  }
  return allowed
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
  const allowed = resolveApprovalBranchPins(rowBrand, appUser.dealers)
  if (!allowed.size) return false

  return allowed.has(code.toUpperCase()) || allowed.has(location.toUpperCase())
}

/** Filter a page of requests down to the ones `appUser` may see. */
export function filterVisibleApprovals<T extends ApprovalScopeRow>(appUser: AppUser | null, rows: T[]): T[] {
  if (canSeeAllApprovals(appUser)) return rows
  return rows.filter((row) => isApprovalVisibleTo(appUser, row))
}
