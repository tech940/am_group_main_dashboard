import 'server-only'

import { and, eq, isNull, like, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { kiaProformas } from '@/lib/db/schema'
import { canUserAccessPermission } from '@/lib/permissions/service'

type KiaProformaRole = AppUser['role']

// Finance Head is the first approver in the chain, so they must be able to reach
// the Pending Approval queue too.
export const KIA_PROFORMA_APPROVER_ROLES = ['admin', 'developer', 'finance_head', 'sales_manager', 'general_manager', 'md'] as const

export function canAccessKiaProforma(role: KiaProformaRole | null | undefined) {
  return Boolean(role)
}

export function canApproveKiaProforma(role: KiaProformaRole | null | undefined, profileApprover?: boolean | null) {
  return profileApprover === true || KIA_PROFORMA_APPROVER_ROLES.includes(role as typeof KIA_PROFORMA_APPROVER_ROLES[number])
}

export async function canApproveKiaProformaForUser(appUser: AppUser, profileApprover?: boolean | null) {
  if (canApproveKiaProforma(appUser.role, profileApprover)) return true
  return canUserAccessPermission(appUser, 'kia.proforma.approve')
}

export function getKiaProformaVisibilityFilter(appUser: AppUser, canApprove = false): SQL<unknown> {
  const base = [isNull(kiaProformas.deletedAt)]
  // Back office sees all proformas; the Sales Executive sees only the ones they generated.
  const isBackOffice = ['admin', 'developer', 'ceo', 'md', 'ea', 'eba', 'manager', 'accounts', 'viewer', 'service_manager', 'purchase_manager', 'sales_manager', 'general_manager', 'finance_head', 'finance_team'].includes(appUser.role)
  if (canApprove || isBackOffice) return and(...base)!
  return and(...base, eq(kiaProformas.loginEmail, appUser.email))!
}

// Single shared approval stage: every approver (Sales Manager, General Manager, MD, admin)
// sees EVERY in-flight proforma, so either the SM or the GM can approve any of them. Legacy
// FINANCE_APPROVED / MANAGER_APPROVED statuses (from the old sequential chain) are folded in.
export function getKiaProformaPendingApprovalFilter(_appUser?: AppUser): SQL<unknown> {
  const allInFlight = or(
    eq(kiaProformas.approvalStatus, 'PENDING'),
    eq(kiaProformas.approvalStatus, ''),
    like(kiaProformas.approvalStatus, 'NOT APPROVED%'),
    eq(kiaProformas.approvalStatus, 'FINANCE_APPROVED'),
    eq(kiaProformas.approvalStatus, 'MANAGER_APPROVED'),
  )!
  return and(isNull(kiaProformas.deletedAt), allInFlight)!
}
