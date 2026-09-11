import { canViewMdTargets } from '@/lib/auth/md-targets-access'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { hasAllBranchAccess } from '@/lib/branches'
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'

/**
 * Sidebar sections whose access is FIXED BY ROLE in code and cannot be granted from the Access Map.
 *
 * Each exists for a stated reason, recorded where its rule lives:
 *  - Targets and Data Health have no permission key on purpose. A key would reach `admin` and `hr`, which
 *    are family 'super' in lib/permissions/tiers.ts — and that tier's bundle is every key there is.
 *  - Call Analysis and Insurance Analysis carry customer names and registration numbers for thousands of
 *    vehicles (lib/auth/restricted-analytics.ts). `insurance_analysis` does exist as a permission group,
 *    but no page reads it — a tick there granted nothing, so the Access Map shows it here instead.
 *  - Social Media Leads is a testing section; Vehicle Tracker is the service floor's camera logger.
 *
 * ── Why they are listed at all (owner's decision, 2026-09-11) ────────────────────────────────────────
 * Every sidebar section must be visible in the Access Map, but these must not become tickable. So they
 * appear READ-ONLY: each cell shows whether that user can see the section under the rule below, and the
 * map never saves them. Their keys are namespaced `locked.` so they can never collide with, or be
 * submitted as, a real permission key.
 *
 * ⚠️ `canView` must call the SAME predicate the sidebar and lib/navigation/sections.ts use. A second copy of
 * a rule is how a map starts saying one thing while the page does another; scripts/verify-nav-map.ts checks
 * every role against the sidebar's own predicates.
 *
 * Pure and client-safe: every import here is already imported by the client-side search registry.
 */

export const LOCKED_SECTION_KEY_PREFIX = 'locked.'

/** The roles the sidebar and search test inline for Social Media Leads. */
export const SOCIAL_MEDIA_LEADS_ROLES = ['md', 'developer', 'admin'] as const

export type LockedSidebarSection = {
  key: `locked.${string}`
  name: string
  href: string
  /** Who can see it, in plain words, shown in the Access Map. */
  rule: string
  canView: (role: string | null | undefined, brand: string | null | undefined) => boolean
}

const normalise = (role: string | null | undefined) => String(role ?? '').trim().toLowerCase()

export const LOCKED_SIDEBAR_SECTIONS: readonly LockedSidebarSection[] = [
  {
    key: 'locked.targets',
    name: 'Targets',
    href: '/targets',
    rule: 'MD and Developer only',
    canView: (role) => canViewMdTargets(role),
  },
  {
    key: 'locked.data_health',
    name: 'Data Health',
    href: '/data-health',
    rule: 'MD and Developer only',
    canView: (role) => isSuperAdminRole(role),
  },
  {
    // app/admin/page.tsx admits isSuperAdminRole and nothing else. The four admin permission groups exist, but
    // none of them opens the console, so a tick there would not grant entry.
    key: 'locked.admin_panel',
    name: 'Admin Panel',
    href: '/admin',
    rule: 'MD and Developer only',
    canView: (role) => isSuperAdminRole(role),
  },
  {
    key: 'locked.call_analysis',
    name: 'Call Analysis',
    href: '/call-analysis',
    rule: 'MD, Developer, EA, EBA and Assistant Manager',
    canView: (role) => canViewRestrictedAnalytics(role),
  },
  {
    key: 'locked.insurance',
    name: 'Insurance Analysis',
    href: '/insurance',
    rule: 'MD, Developer, EA, EBA and Assistant Manager',
    canView: (role) => canViewRestrictedAnalytics(role),
  },
  {
    key: 'locked.social_media_leads',
    name: 'Social Media Leads',
    href: '/social-media-leads',
    rule: 'MD, Developer and Admin',
    canView: (role) => (SOCIAL_MEDIA_LEADS_ROLES as readonly string[]).includes(normalise(role)),
  },
  {
    key: 'locked.vehicle_tracker',
    name: 'Vehicle Tracker',
    href: '/brands/kia/vehicle-tracker',
    rule: 'MD, Developer and Service GM, for KIA users',
    // Mirrors isSidebarItemVisible in components/layout/sidebar.tsx, brand test included.
    canView: (role, brand) =>
      canViewVehicleTracker(role) && (brand === 'kia' || hasAllBranchAccess(brand) || hasGlobalAccessRole(role)),
  },
]

/**
 * Permission groups that exist in the registry but that no page honours, because a LOCKED section above
 * replaces them. The Access Map drops them as tickable columns so a tick can no longer pretend to grant.
 */
export const GROUPS_REPLACED_BY_LOCKED_SECTIONS: ReadonlySet<string> = new Set(['insurance_analysis'])

export function isLockedSectionKey(key: string): boolean {
  return key.startsWith(LOCKED_SECTION_KEY_PREFIX)
}
