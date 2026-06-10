import 'server-only'

import { and, eq, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { mgProformas } from '@/lib/db/schema'
import { canUserAccessPermission } from '@/lib/permissions/service'

type MgProformaRole = AppUser['role']

export const MG_PROFORMA_APPROVER_ROLES = ['admin', 'ceo', 'md', 'ea', 'manager'] as const

export function canAccessMgProforma(role: MgProformaRole | null | undefined) {
  return Boolean(role)
}

export function canApproveMgProforma(role: MgProformaRole | null | undefined, profileApprover?: boolean | null) {
  return profileApprover === true || MG_PROFORMA_APPROVER_ROLES.includes(role as typeof MG_PROFORMA_APPROVER_ROLES[number])
}

export async function canApproveMgProformaForUser(appUser: AppUser, profileApprover?: boolean | null) {
  if (canApproveMgProforma(appUser.role, profileApprover)) return true
  return canUserAccessPermission(appUser, 'mg.proforma.approve')
}

export function getMgProformaVisibilityFilter(appUser: AppUser, canApprove = false): SQL<unknown> {
  const base = [isNull(mgProformas.deletedAt)]
  if (canApprove) return and(...base)!
  return and(...base, eq(mgProformas.loginEmail, appUser.email))!
}

export function getMgProformaPendingApprovalFilter() {
  return and(
    isNull(mgProformas.deletedAt),
    or(
      eq(mgProformas.approvalStatus, 'PENDING'),
      eq(mgProformas.approvalStatus, ''),
      eq(mgProformas.approvalStatus, 'NOT APPROVED')
    )
  )!
}
