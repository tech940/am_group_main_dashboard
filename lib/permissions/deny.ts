import type { AppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'

/**
 * True when the user has an explicit Access-Map Deny (an `allowed=false` override) for this
 * permission. Super Admins (developer, md) are never denied.
 *
 * This layers a per-user Deny on top of the legacy role-based `canAccessX` gates for the common
 * modules (Petty Cash / Finance Orders / AM Finance), which otherwise ignore the Access Map. It
 * only ever REVOKES on an explicit deny — it never grants or reduces access for a role that was
 * simply never templated — so it can't accidentally lock out a role the gate already allows.
 * Fails open (returns false) if the permission tables are unavailable.
 */
export async function isPermissionDenied(appUser: AppUser | null, permissionKey: string): Promise<boolean> {
  if (!appUser) return false
  if (isSuperAdminRole(appUser.role)) return false
  try {
    const snapshot = await getUserPermissionSnapshot(appUser.id)
    return snapshot.overrides[permissionKey] === false
  } catch {
    return false
  }
}

/**
 * True when an admin EXPLICITLY ticked this permission for this user in the Access Map (an
 * `allowed=true` override row in `user_permissions`).
 *
 * This is the mirror of isPermissionDenied above, and it exists to fix a real, reported bug: several
 * sections are guarded by a hardcoded ROLE allowlist while the sidebar and the search registry
 * consult the permission snapshot. An admin would tick the section in Admin → Access, the link would
 * appear, and clicking it landed on "access restricted". The grant was inert.
 *
 * ⚠️ Deliberately reads `overrides`, NOT `effective`. `effective` also contains everything the
 * user's role template and tier bundle grant, so keying off it would turn every one of these
 * allowlists into "whatever the tier model already hands out" — a large, silent widening. `overrides`
 * contains ONLY the explicit per-user decisions an admin made by hand, so this widens access by
 * exactly one user and one section at a time, which is what ticking the box is supposed to mean.
 *
 * Deny still wins: an `allowed=false` override sets this to false, and the callers keep their
 * separate isPermissionDenied check.
 *
 * Fails CLOSED (returns false) if the permission tables are unavailable — an unreadable snapshot
 * must never be treated as a grant.
 */
export async function isPermissionExplicitlyAllowed(appUser: AppUser | null, permissionKey: string): Promise<boolean> {
  if (!appUser) return false
  if (isSuperAdminRole(appUser.role)) return true
  try {
    const snapshot = await getUserPermissionSnapshot(appUser.id)
    return snapshot.overrides[permissionKey] === true
  } catch {
    return false
  }
}
