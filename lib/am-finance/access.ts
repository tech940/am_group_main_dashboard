import type { AppUser } from '@/lib/auth/app-user'
import { hasGlobalAccessRole } from '@/lib/auth/roles'
import { AM_FINANCE_VIEW_ROLES } from '@/lib/permissions/legacy-module-roles'
import { isPermissionDenied, isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'

// Shared with the sidebar so the link and the page guard can never drift. See legacy-module-roles.ts.
const AM_FINANCE_ALLOWED_ROLES = new Set<AppUser['role']>(AM_FINANCE_VIEW_ROLES)

export function canAccessAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role && (AM_FINANCE_ALLOWED_ROLES.has(role) || hasGlobalAccessRole(role)))
}

export function canCreateAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role && AM_FINANCE_ALLOWED_ROLES.has(role))
}

export function canEditAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role && AM_FINANCE_ALLOWED_ROLES.has(role))
}

export function canAuditAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role && AM_FINANCE_ALLOWED_ROLES.has(role))
}

export function getAmFinancePermissions(role: AppUser['role'] | null | undefined) {
  return {
    view: canAccessAmFinance(role),
    create: canCreateAmFinance(role),
    edit: canEditAmFinance(role),
    audit: canAuditAmFinance(role),
  }
}

/**
 * The FULL view rule — role gate, plus the Access-Map allow AND deny.
 *
 * ── The drift this closes ─────────────────────────────────────────────────────────────────────
 * app/am-finance/page.tsx admitted `canAccessAmFinance(role) || isPermissionExplicitlyAllowed(...)`
 * and then refused on `isPermissionDenied(...)`. All three routes under app/api/am-finance/ checked
 * `canAccessAmFinance(role)` ALONE. So:
 *
 *   - a user GRANTED am_finance.view in the Access Map loaded the page and every request 403'd; and,
 *     the more serious direction,
 *   - a user DENIED am_finance.view was still served by the API, because the routes never asked.
 *     The page said no and the data came out anyway.
 *
 * `canAccessAmFinance` stays as-is — the sidebar and the create/edit gates use it synchronously.
 * This is the async view decision, and the page and every route must call THIS one.
 */
export async function canViewAmFinance(appUser: AppUser | null): Promise<boolean> {
  if (!appUser) return false
  // A deny always wins, whatever the role says.
  if (await isPermissionDenied(appUser, 'am_finance.view')) return false
  if (canAccessAmFinance(appUser.role)) return true
  return isPermissionExplicitlyAllowed(appUser, 'am_finance.view')
}
