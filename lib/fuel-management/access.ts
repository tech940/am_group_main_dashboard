import 'server-only'

import type { AppUser } from '@/lib/auth/app-user'
import { isPermissionDenied, isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'

/**
 * The ONE statement of who may open Fuel Management.
 *
 * app/fuel-management/page.tsx and app/api/fuel-management/route.ts both call canViewFuelManagement, and neither
 * restates any part of it. They differ only in how they say no: forbidden() on the page, a JSON 403 from the API.
 *
 * ── Why it is one function ─────────────────────────────────────────────────────────────────────────────────
 * The page used to apply this rule while the API checked only that someone was signed in, so every employee the
 * page refused could still read every fuel record straight from the API. Guard/API desync is this codebase's
 * recurring access defect (lib/gate-pass/access.ts lists the outages it caused); stating the rule once is the fix.
 *
 * ── The rule — the page's rule as it stood on 2026-09-11, neither widened nor narrowed ──────────────────────
 *  1. An explicit Access-Map Deny on fuel_management.view wins → no. (Super Admins are never denied.)
 *  2. Otherwise yes when ANY of: the effective permission map grants fuel_management.view, fuel_approvals.view or
 *     gate_pass.view; an explicit Access-Map allow on fuel_management.view; or the role is on the list below.
 *
 * ── No branch scoping, deliberately ───────────────────────────────────────────────────────────────────────
 * GET /api/fuel-approvals, the Fuel Approvals list, applies no dealer pin: it returns every branch's requests to
 * anyone it admits. So this section does not invent one — the same people already see the same fills there.
 *
 * A failure to read the permission snapshot propagates (the page shows its error boundary, the API answers 500),
 * exactly as the page behaved before. An unreadable snapshot is never treated as a grant.
 */

export const FUEL_MANAGEMENT_VIEW_PERMISSION = 'fuel_management.view' as const
export type FuelManagementViewPermission = typeof FUEL_MANAGEMENT_VIEW_PERMISSION

/**
 * The ONE permission whose grant opens this section.
 *
 * ⚠️ It used to be three: holding fuel_approvals.view or gate_pass.view opened Fuel Management as well. And
 * gate_pass.view is granted to nearly every role, so in practice the section reached almost the whole company.
 * The owner restricted it on 2026-09-11 to EA, MD and Developer — which is also why the CEO and HR, who keep
 * Fuel Approvals, do not get this. Anyone else needs an individual Access-Map tick on fuel_management.view.
 */
const GRANTING_PERMISSIONS = [FUEL_MANAGEMENT_VIEW_PERMISSION] as const

const FUEL_MANAGEMENT_VIEW_ROLES: ReadonlySet<string> = new Set([
  'developer',
  'md',
  'ea',
])

export async function canViewFuelManagement(appUser: AppUser | null | undefined): Promise<boolean> {
  if (!appUser) return false

  if (await isPermissionDenied(appUser, FUEL_MANAGEMENT_VIEW_PERMISSION)) return false

  const snapshot = await getUserPermissionSnapshot(appUser.id)
  if (GRANTING_PERMISSIONS.some((key) => snapshot.effective[key] === true)) return true

  if (await isPermissionExplicitlyAllowed(appUser, FUEL_MANAGEMENT_VIEW_PERMISSION)) return true

  return FUEL_MANAGEMENT_VIEW_ROLES.has(String(appUser.role ?? '').trim().toLowerCase())
}

/**
 * The ONE statement of who may change what the numbers are measured AGAINST.
 *
 * Expected mileage, tank capacity and every threshold are configuration (migration 0064) precisely so that
 * nobody has to edit code to change them. The cost of that is real: raising an expected figure re-labels a
 * whole fleet as underperforming, and lowering it makes a genuine problem disappear from every screen at
 * once. So this is deliberately a much shorter list than who may LOOK.
 *
 * ⚠️ It does NOT inherit the view grants. canViewFuelManagement opens to anyone holding fuel_approvals.view
 * or gate_pass.view, which is most of the company's managers — correct for reading, wrong for setting the
 * benchmark they are read against. Owner's decision, 2026-09-11: MD, GM and admin.
 *
 * The permission key already exists — `fuel_management` declares an `edit` action in
 * lib/permissions/registry.ts — so granting it needs no migration and no PERMISSION_CACHE_VERSION bump.
 *
 * Every change made through this permission is recorded in fuel_config_events, which is append-only by
 * trigger: the previous value survives even if someone edits a benchmark back.
 */
export const FUEL_MANAGEMENT_EDIT_PERMISSION = 'fuel_management.edit' as const

const FUEL_MANAGEMENT_EDIT_ROLES: ReadonlySet<string> = new Set([
  'developer',
  'admin',
  'md',
  'general_manager',
])

export async function canEditFuelManagement(appUser: AppUser | null | undefined): Promise<boolean> {
  if (!appUser) return false

  if (await isPermissionDenied(appUser, FUEL_MANAGEMENT_EDIT_PERMISSION)) return false

  const snapshot = await getUserPermissionSnapshot(appUser.id)
  if (snapshot.effective[FUEL_MANAGEMENT_EDIT_PERMISSION] === true) return true

  if (await isPermissionExplicitlyAllowed(appUser, FUEL_MANAGEMENT_EDIT_PERMISSION)) return true

  return FUEL_MANAGEMENT_EDIT_ROLES.has(String(appUser.role ?? '').trim().toLowerCase())
}
