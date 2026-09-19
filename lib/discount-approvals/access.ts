import 'server-only'

import type { AppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { hasExplicitBrandGrant, isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'

/**
 * Who may read and act on the AM Hyundai / AM Platinum discount requests (`discount_approvals`).
 *
 * One definition for every surface — the list (GET /api/discount-approvals), the Approve/Reject action
 * (PATCH), the logged-in half of the lookup, the brand pages and the Approvals page's brand tabs — so a
 * tab can never offer what the API then refuses.
 *
 * ⚠️ Until 2026-09-19 the list and the action only checked "logged in": any employee with brand access
 * could read every request, and a `general_manager` of ANY brand (KIA's included) could clear Hyundai's
 * stage 1. The people who have actually approved — the Hyundai and Platinum GSMs and the MD — all pass
 * both checks below, so the real workflow is unchanged.
 *
 * KIA's discounts are a different system (kia_booking_discounts, lib/kia/discount-chain.ts).
 */
export const DISCOUNT_APPROVAL_PERMISSION = 'hyundai.sales.discount_approvals.view'

/** The two brands whose requests live in `discount_approvals`, as the public forms submit them. */
export const DISCOUNT_APPROVAL_BRANCHES = ['hyundai', 'platinum'] as const
export type DiscountApprovalBranch = (typeof DISCOUNT_APPROVAL_BRANCHES)[number]

export function isDiscountApprovalBranch(value: unknown): value is DiscountApprovalBranch {
  return typeof value === 'string' && (DISCOUNT_APPROVAL_BRANCHES as readonly string[]).includes(value)
}

/** The section permission — role template or an Access-Map tick. */
export async function canViewDiscountApprovals(appUser: AppUser | null): Promise<boolean> {
  if (!appUser) return false
  if ((await requirePermission(appUser, DISCOUNT_APPROVAL_PERMISSION)).allowed) return true
  return isPermissionExplicitlyAllowed(appUser, DISCOUNT_APPROVAL_PERMISSION)
}

/** The brand door for one branch's requests: the user's brand (or all), or an Access-Map brand grant. */
export async function canAccessDiscountBranch(appUser: AppUser | null, branch: string): Promise<boolean> {
  if (!appUser || !isDiscountApprovalBranch(branch)) return false
  return canAccessBrand(appUser, branch) || hasExplicitBrandGrant(appUser, branch)
}

/** The branches this user may see requests for — empty when they may see none. */
export async function discountBranchesFor(appUser: AppUser | null): Promise<DiscountApprovalBranch[]> {
  if (!(await canViewDiscountApprovals(appUser))) return []
  const out: DiscountApprovalBranch[] = []
  for (const branch of DISCOUNT_APPROVAL_BRANCHES) {
    if (await canAccessDiscountBranch(appUser, branch)) out.push(branch)
  }
  return out
}

/**
 * Fields never sent to a browser from the DMS booking/sales rows. PAN is never serialised anywhere in
 * this app; GST number rides the same rule.
 */
export const NEVER_SERIALISED_FEED_FIELDS = ['pan_number', 'pan_no', 'customer_gst_no'] as const
