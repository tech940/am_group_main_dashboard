import type { AppUser } from '@/lib/auth/app-user'
import { hasGlobalAccessRole } from '@/lib/auth/roles'
import { AM_FINANCE_VIEW_ROLES } from '@/lib/permissions/legacy-module-roles'

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
