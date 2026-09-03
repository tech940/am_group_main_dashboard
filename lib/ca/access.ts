import 'server-only'

import type { AppUser } from '@/lib/auth/app-user'
import { isCaViewRole } from '@/lib/permissions/legacy-module-roles'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'

/**
 * May this user see the CA section?
 *
 * ── The drift this closes ─────────────────────────────────────────────────────────────────────
 * The page admitted `isCaViewRole(role) || isPermissionExplicitlyAllowed(user, 'ca.view')`, while
 * all three routes under app/api/ca/ checked `isCaViewRole` ALONE. So a user granted `ca.view`
 * through the Access Map loaded the page and then watched every single request 403 — a section that
 * renders its own chrome and nothing else.
 *
 * That is the guard-desync class this codebase has now hit four times (sidebar-vs-page twice,
 * petty cash, and here), which is why the rule lives in one place rather than being restated per
 * route. The page keeps `forbidden()` and the routes keep their JSON 403 — only the PREDICATE is
 * shared, because that is the part that drifted.
 *
 * ⚠️ Access is a hardcoded role list (ca / md / developer, lib/permissions/legacy-module-roles.ts)
 * by product decision, NOT the tier system — so no role template or tier bundle can widen it. The
 * explicit Access-Map allow is the one deliberate exception, and it must be honoured on BOTH sides
 * or the grant is worse than useless.
 */
export async function canViewCa(appUser: AppUser | null): Promise<boolean> {
  if (!appUser) return false
  if (isCaViewRole(appUser.role)) return true
  return isPermissionExplicitlyAllowed(appUser, 'ca.view')
}
