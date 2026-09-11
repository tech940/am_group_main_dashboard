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

/** Permissions whose grant also opens this section: it is built from those two sections' records. */
const GRANTING_PERMISSIONS = [FUEL_MANAGEMENT_VIEW_PERMISSION, 'fuel_approvals.view', 'gate_pass.view'] as const

const FUEL_MANAGEMENT_VIEW_ROLES: ReadonlySet<string> = new Set([
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
  'general_manager',
  'service_manager',
  'sales_manager',
])

export async function canViewFuelManagement(appUser: AppUser | null | undefined): Promise<boolean> {
  if (!appUser) return false

  if (await isPermissionDenied(appUser, FUEL_MANAGEMENT_VIEW_PERMISSION)) return false

  const snapshot = await getUserPermissionSnapshot(appUser.id)
  if (GRANTING_PERMISSIONS.some((key) => snapshot.effective[key] === true)) return true

  if (await isPermissionExplicitlyAllowed(appUser, FUEL_MANAGEMENT_VIEW_PERMISSION)) return true

  return FUEL_MANAGEMENT_VIEW_ROLES.has(String(appUser.role ?? '').trim().toLowerCase())
}
