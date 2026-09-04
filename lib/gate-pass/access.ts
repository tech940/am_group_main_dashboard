import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { parseUserDealers } from '@/lib/dealers/registry'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { requirePermission } from '@/lib/permissions/service'

/**
 * The ONE statement of who may do what in Demo Car GatePass.
 *
 * ── Why it is one file ────────────────────────────────────────────────────────────────────────
 * Guard/API desync is this codebase's recurring defect class — it has caused four separate
 * outages, every one of them the same shape: a page and the routes behind it each restated the
 * access rule, and the two restatements drifted. The CA section admitted an Access-Map grant on the
 * page while all three of its routes checked a role list, so a granted user loaded the section and
 * watched every request 403. The Vendor Registry had a COMMENT claiming it was gated and no code at
 * all, and shipped anonymous read of bank account numbers.
 *
 * So the page and every route import the predicate from here. They differ only in how they say no
 * (forbidden() vs a JSON 403), because that is the part that never drifted.
 */

/**
 * The approver list lives in access-shared.ts and is RE-EXPORTED here, not restated.
 *
 * The UI needs it too (to decide whether to render an Approve button) and cannot import this file,
 * which is server-only. A second copy on the client is exactly how a button comes to appear for
 * someone the server then 403s — the guard-desync class this codebase has hit four times.
 */
import { isGatePassApproverRole } from './access-shared'

export { GATE_PASS_APPROVER_ROLES, isGatePassApproverRole } from './access-shared'

/**
 * Which dealer codes this user's passes are scoped to.
 *
 * ⚠️ An UNPINNED user gets their whole brand, not nothing.
 *
 * The two postures in this repo contradict each other — approvals treats an unpinned user as deny,
 * lib/auth/dealer-scope.ts treats the same user as unrestricted — and roughly two thirds of users
 * carry no dealer pin. Fail-closed is the posture that produced the worst outage in this app's
 * history: four EAs saw 0 of 222 approval requests with Rs18.4L stalled behind them, because
 * nobody had ticked a branch on their profile.
 *
 * A gate pass is not money and KIA has exactly two branches, so the cost of an unpinned Sales
 * Manager seeing both gates is that they see four extra cars. The cost of the other choice is a
 * manager who cannot approve anything and does not know why. Fail open, deliberately.
 */
export function visibleDealerCodes(appUser: AppUser): string[] {
  const pinned = parseUserDealers(appUser.brand, appUser.dealers)
  if (pinned.length > 0) return pinned
  return KIA_BRANCH_DEALERS.map((dealer) => dealer.dealerCode)
}

export function canSeeAllGatePassDealers(appUser: AppUser): boolean {
  if (isSuperAdminRole(appUser.role)) return true
  return parseUserDealers(appUser.brand, appUser.dealers).length === 0
}

/** May this user act on a pass raised at this dealer code? */
export function isDealerInScope(appUser: AppUser, dealerCode: string | null | undefined): boolean {
  if (isSuperAdminRole(appUser.role)) return true
  const code = String(dealerCode ?? '').trim().toUpperCase()
  if (!code) return false
  return visibleDealerCodes(appUser).includes(code)
}

/**
 * May this user approve or reject THIS pass?
 *
 * Both halves matter. The role says they are an approver at all; the dealer scope says they are an
 * approver at the branch the car is leaving from. A Sales Manager pinned to Udhampur signing out a
 * Jammu car is exactly what the branch pin exists to prevent.
 */
export function canApproveGatePass(appUser: AppUser | null, dealerCode: string | null | undefined): boolean {
  if (!appUser) return false
  if (!isGatePassApproverRole(appUser.role)) return false
  return isDealerInScope(appUser, dealerCode)
}

/** May this user cancel it? The person who raised it, or anyone who could have approved it. */
export function canCancelGatePass(
  appUser: AppUser | null,
  pass: { requestedBy: string | null; dealerCode: string | null },
): boolean {
  if (!appUser) return false
  if (pass.requestedBy && pass.requestedBy === appUser.id) return true
  return canApproveGatePass(appUser, pass.dealerCode)
}

export async function canViewGatePass(appUser: AppUser | null): Promise<boolean> {
  if (!appUser) return false
  const permission = await requirePermission(appUser, 'gate_pass.view')
  if (permission.allowed) return true
  // An explicit Access-Map allow must be honoured here as well as on the page, or the grant is
  // worse than useless — that is precisely the CA drift described at the top of this file.
  return isPermissionExplicitlyAllowed(appUser, 'gate_pass.view')
}

export type GatePassAccess =
  | { denied: NextResponse; appUser?: undefined }
  | { denied?: undefined; appUser: AppUser }

/**
 * The API guard. Every route under app/api/gate-pass/** calls this first.
 *
 * ⚠️ It answers "may you use this section at all". It does NOT scope rows — a list endpoint must
 * additionally filter on visibleDealerCodes(), or a correctly-permissioned Udhampur user still
 * receives every Jammu pass. The Vendor Registry shipped exactly that bug: the right permission and
 * no row filter handed over the whole group's payment ledger.
 */
export async function requireGatePassAccess(
  permissionKey: 'gate_pass.view' | 'gate_pass.create' | 'gate_pass.edit' | 'gate_pass.approve' | 'gate_pass.audit' = 'gate_pass.view',
): Promise<GatePassAccess> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const permission = await requirePermission(appUser, permissionKey)
  if (permission.allowed) return { appUser }

  if (await isPermissionExplicitlyAllowed(appUser, permissionKey)) return { appUser }

  return { denied: NextResponse.json({ error: permission.reason }, { status: 403 }) }
}
