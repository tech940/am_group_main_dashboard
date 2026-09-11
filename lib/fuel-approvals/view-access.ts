import 'server-only'

import type { AppUser } from '@/lib/auth/app-user'
import { isPermissionDenied, isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'

/**
 * Who may OPEN Fuel Approvals and read its data — the ONE statement of that rule.
 *
 * app/fuel-approvals/page.tsx and app/api/fuel-approvals/last-fuel/route.ts both call this. Before
 * 2026-09-11 the page stated the rule inline and the last-fuel route checked ONLY an explicit
 * Access-Map deny, so any signed-in employee the page had turned away could still query the fuel
 * history of any vehicle through the route. That is the guard/API desync this codebase keeps
 * producing; the fix is one predicate, not two careful copies.
 *
 * The rule is moved here VERBATIM from the page. It neither widens nor narrows who gets in:
 *   1. an explicit Access-Map Deny on fuel_approvals.view wins over everything below (super admins
 *      are never denied — see isPermissionDenied);
 *   2. otherwise the effective snapshot granting fuel_approvals.view;
 *   3. otherwise an explicit Access-Map Allow for this user;
 *   4. otherwise one of FUEL_APPROVALS_VIEW_ROLES.
 *
 * ⚠️ This is about VIEWING. Who may approve which stage is canUserApproveStage in
 * lib/fuel-approvals/access.ts — the workflow's own rule, deliberately not touched here.
 *
 * Server-only: it reads the permission snapshot. The search registry cannot import it; that is why
 * /fuel-approvals in lib/navigation/sections.ts resolves through the same 'fuel_approvals.view' key.
 */
export const FUEL_APPROVALS_VIEW_ROLES = [
  'developer',
  'admin',
  'ceo',
  'accounts',
  'finance_head',
  'finance_team',
  'md',
  'ed',
  'ea',
  'eba',
  'hr',
] as const

export async function canViewFuelApprovals(appUser: AppUser | null | undefined): Promise<boolean> {
  if (!appUser) return false

  if (await isPermissionDenied(appUser, 'fuel_approvals.view')) return false

  // Not wrapped: the page has always let a snapshot failure surface as an error rather than guess,
  // and a route calling this inside its own try/catch answers 500, not a grant.
  const snapshot = await getUserPermissionSnapshot(appUser.id)
  if (snapshot.effective['fuel_approvals.view'] === true) return true

  if (await isPermissionExplicitlyAllowed(appUser, 'fuel_approvals.view')) return true

  const role = String(appUser.role || '').trim().toLowerCase()
  return (FUEL_APPROVALS_VIEW_ROLES as readonly string[]).includes(role)
}
