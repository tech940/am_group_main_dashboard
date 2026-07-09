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
