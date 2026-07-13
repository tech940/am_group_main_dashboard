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

// The Pending Approval queue is scoped to the stage the viewer actually acts on, so each approver
// sees only what is waiting on THEM:
//   • Sales Manager / General Manager → stage 1 only (PENDING / '' / declined-restart / legacy
//     FINANCE_APPROVED). They do NOT see proformas already handed off to Finance.
//   • Finance Head / Finance Team → stage 2 only (MANAGER_APPROVED). They do NOT see the Sales
//     Manager / GM queue.
//   • MD / admin / developer (and any other approver) → EVERY in-flight proforma.
// The per-stage role gate that enforces WHO may approve lives in roleActsOnKiaStage; this only
// controls WHAT each role sees in the queue.
export function getKiaProformaPendingApprovalFilter(appUser?: AppUser): SQL<unknown> {
  // Stage 1 — awaiting Sales Manager / GM (PENDING, blank, declined restart, legacy FINANCE_APPROVED).
  const stage1 = or(
    eq(kiaProformas.approvalStatus, 'PENDING'),
    eq(kiaProformas.approvalStatus, ''),
    like(kiaProformas.approvalStatus, 'NOT APPROVED%'),
    eq(kiaProformas.approvalStatus, 'FINANCE_APPROVED'),
  )!
  // Stage 2 — Manager-approved, awaiting Finance.
  const stage2 = eq(kiaProformas.approvalStatus, 'MANAGER_APPROVED')

  const role = String(appUser?.role || '').trim().toLowerCase()
  let stageFilter: SQL<unknown>
  if (role === 'finance_head' || role === 'finance_team') {
    stageFilter = stage2
  } else if (role === 'sales_manager' || role === 'general_manager') {
    stageFilter = stage1
  } else {
    stageFilter = or(stage1, stage2)!
  }
  return and(isNull(kiaProformas.deletedAt), stageFilter)!
}
