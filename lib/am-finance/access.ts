import type { AppUser } from '@/lib/auth/app-user'

const AM_FINANCE_CREATE_ROLES = new Set<AppUser['role']>(['admin', 'finance_head', 'accounts'])
const AM_FINANCE_EDIT_ROLES = new Set<AppUser['role']>(['admin', 'finance_head', 'accounts'])
const AM_FINANCE_AUDIT_ROLES = new Set<AppUser['role']>(['admin', 'ceo', 'md', 'finance_head'])

export function canAccessAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role)
}

export function canCreateAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role && AM_FINANCE_CREATE_ROLES.has(role))
}

export function canEditAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role && AM_FINANCE_EDIT_ROLES.has(role))
}

export function canAuditAmFinance(role: AppUser['role'] | null | undefined) {
  return Boolean(role && AM_FINANCE_AUDIT_ROLES.has(role))
}

export function getAmFinancePermissions(role: AppUser['role'] | null | undefined) {
  return {
    view: canAccessAmFinance(role),
    create: canCreateAmFinance(role),
    edit: canEditAmFinance(role),
    audit: canAuditAmFinance(role),
  }
}
