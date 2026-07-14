import 'server-only'

import { and, eq, inArray, isNull, like, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { kiaProformas } from '@/lib/db/schema'
import { canUserAccessPermission } from '@/lib/permissions/service'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'

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

  // Branch boundary: if the user is dealer-scoped, restrict visibility to their allowed branch locations.
  const dealerScope = getUserDealerScope(appUser, 'kia')
  if (dealerScope && dealerScope.length > 0) {
    base.push(inArray(kiaProformas.location, dealerScope))
  }

  // Back office sees all proformas; the Sales Executive sees only the ones they generated.
  const isBackOffice = ['admin', 'developer', 'ceo', 'md', 'ea', 'eba', 'manager', 'accounts', 'viewer', 'service_manager', 'purchase_manager', 'sales_manager', 'general_manager', 'finance_head', 'finance_team'].includes(appUser.role)
  if (canApprove || isBackOffice) return and(...base)!
  return and(...base, eq(kiaProformas.loginEmail, appUser.email))!
}

// The Proforma module's Pending Approval queue is Sales-Manager / General-Manager (stage 1) ONLY.
// Finance (stage 2, MANAGER_APPROVED) approval now lives EXCLUSIVELY in the dedicated /finance section
// (which reads its own getKiaFinanceApprovalQueue). A proforma handed off to Finance therefore no
// longer appears in this Proforma-section queue for ANY role — including MD / admin / developer, who
// perform the final Finance approval from /finance instead. The per-stage role gate that enforces WHO
// may approve still lives in roleActsOnKiaStage.
export function getKiaProformaPendingApprovalFilter(): SQL<unknown> {
  // Stage 1 — awaiting Sales Manager / GM (PENDING, blank, declined restart, legacy FINANCE_APPROVED).
  const stage1 = or(
    eq(kiaProformas.approvalStatus, 'PENDING'),
    eq(kiaProformas.approvalStatus, ''),
    like(kiaProformas.approvalStatus, 'NOT APPROVED%'),
    eq(kiaProformas.approvalStatus, 'FINANCE_APPROVED'),
  )!
  return and(isNull(kiaProformas.deletedAt), stage1)!
}
