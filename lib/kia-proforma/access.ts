import 'server-only'

import { and, eq, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { kiaProformas } from '@/lib/db/schema'
import { canUserAccessPermission } from '@/lib/permissions/service'

type KiaProformaRole = AppUser['role']

export const KIA_PROFORMA_APPROVER_ROLES = ['admin', 'super_admin', 'sales_manager', 'general_manager', 'md'] as const

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
  const isBackOffice = ['admin', 'super_admin', 'ceo', 'md', 'ea', 'eba', 'manager', 'accounts', 'viewer', 'service_manager', 'purchase_manager', 'sales_manager', 'general_manager', 'finance_head', 'finance_team'].includes(appUser.role)
  if (canApprove || isBackOffice) return and(...base)!
  return and(...base, eq(kiaProformas.loginEmail, appUser.email))!
}

export function getKiaProformaPendingApprovalFilter() {
  return and(
    isNull(kiaProformas.deletedAt),
    or(
      eq(kiaProformas.approvalStatus, 'PENDING'),
      eq(kiaProformas.approvalStatus, ''),
      eq(kiaProformas.approvalStatus, 'NOT APPROVED')
    )
  )!
}
