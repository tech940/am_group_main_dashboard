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

/**
 * Does this user hold an explicit Access-Map grant on ANY section of this brand?
 *
 * ── The bug this closes ──────────────────────────────────────────────────────────────────────────
 * ⚠️ An admin ticks "Hyundai user → KIA Sales Report" in the Access Map. The override is stored, and
 * `resolveEffectiveSnapshot` correctly re-applies it so `requirePermission` says yes. Then the page
 * calls `getBrandAccess('kia')`, which is a pure comparison of the user's `brand` column against the
 * string 'kia', knows nothing about permissions, and returns false. `forbidden()`. The box is ticked,
 * the database agrees, the permission resolver agrees — and the brand gate throws the decision away.
 *
 * Exactly the same class of defect as the one resolveEffectiveSnapshot already carries a long comment
 * about, one layer further out: a DEFAULT (which brand you belong to) must not overrule a DECISION
 * (this person may see this section).
 *
 * ── Why a brand-wide answer is safe ──────────────────────────────────────────────────────────────
 * ⚠️ This opens the BRAND gate, not the section. Every page and route behind it keeps its own
 * `requirePermission('<brand>.<section>.view')`, so a user granted one KIA section passes the brand
 * door and is still refused at every KIA section they were not granted. Verified across the guarded
 * pages before this was written.
 *
 * ⚠️ READS `overrides`, NOT `effective` — the same rule as isPermissionExplicitlyAllowed above.
 * `effective` carries everything a role template and tier bundle hand out, so keying off it would
 * turn "belongs to brand X" into "any role whose template mentions brand X", which is most of them.
 * `overrides` holds only what an admin ticked by hand.
 *
 * Fails CLOSED if the permission tables are unreadable: an unavailable snapshot is never a grant.
 */
export async function hasExplicitBrandGrant(appUser: AppUser | null, brand: string): Promise<boolean> {
  if (!appUser) return false
  if (isSuperAdminRole(appUser.role)) return true
  const prefix = `${String(brand || '').trim().toLowerCase()}.`
  if (prefix === '.') return false
  try {
    const snapshot = await getUserPermissionSnapshot(appUser.id)
    return Object.entries(snapshot.overrides).some(
      ([key, allowed]) => allowed === true && key.toLowerCase().startsWith(prefix),
    )
  } catch {
    return false
  }
}
