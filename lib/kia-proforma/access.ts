import 'server-only'

import { and, eq, isNull, like, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { kiaProformas } from '@/lib/db/schema'
import { canUserAccessPermission } from '@/lib/permissions/service'

type KiaProformaRole = AppUser['role']

// The chain is Sales Manager / GM (stage 1) -> Finance Head / Finance Team (stage 2).
// Every one of these roles needs to reach the Pending Approval queue.
export const KIA_PROFORMA_APPROVER_ROLES = ['admin', 'developer', 'finance_head', 'finance_team', 'sales_manager', 'general_manager', 'md'] as const

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

// Every approver (Sales Manager, GM, Finance Head, Finance Team, MD, admin) sees EVERY in-flight
// proforma. In-flight = awaiting stage 1 (PENDING / '') OR stage 2 (MANAGER_APPROVED) OR declined
// (restarts). The per-stage role gate lives in roleActsOnKiaStage; the server enforces it on approve.
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
