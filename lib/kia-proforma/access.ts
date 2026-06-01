import 'server-only'

import { and, eq, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { kiaProformas } from '@/lib/db/schema'

type KiaProformaRole = AppUser['role']

export const KIA_PROFORMA_APPROVER_ROLES = ['admin', 'ceo', 'md', 'ea', 'manager'] as const

export function canAccessKiaProforma(role: KiaProformaRole | null | undefined) {
  return Boolean(role)
}

export function canApproveKiaProforma(role: KiaProformaRole | null | undefined, profileApprover?: boolean | null) {
  return profileApprover === true || KIA_PROFORMA_APPROVER_ROLES.includes(role as typeof KIA_PROFORMA_APPROVER_ROLES[number])
}

export function getKiaProformaVisibilityFilter(appUser: AppUser, profileApprover?: boolean | null): SQL<unknown> {
  const base = [isNull(kiaProformas.deletedAt)]
  if (canApproveKiaProforma(appUser.role, profileApprover)) return and(...base)!
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
