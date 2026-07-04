import type { AppUser } from '@/lib/auth/app-user'
import { hasGlobalAccessRole } from '@/lib/auth/roles'

const AM_FINANCE_ALLOWED_ROLES = new Set<AppUser['role']>(['admin', 'super_admin', 'ceo', 'md', 'ea', 'eba'])

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
