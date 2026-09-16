import { canViewMdTargets } from '@/lib/auth/md-targets-access'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { hasAllBranchAccess } from '@/lib/branches'
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'

/**
 * Sidebar sections that CANNOT be granted from the Access Map.
 *
 * ⚠️ THIS LIST IS NOW EMPTY — see the note on LOCKED_SIDEBAR_SECTIONS below. What follows describes
 * why the six former entries existed, because the reasoning still explains why their replacements are
 * grant-only rather than ordinary keys.
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

/*
 * ⚠️ EMPTY SINCE 2026-09-16, and it must stay a real list rather than be deleted.
 *
 * All six entries — Targets, Data Health, Admin Panel, Call Analysis, Social Media Leads and Vehicle
 * Tracker — became ordinary grantable sections on the owner's instruction: "nothing should be fixed
 * by role, if I want I can give access to those sections as well". Each now has a real permission key
 * (see GRANT_ONLY_SECTIONS in lib/permissions/registry.ts) and a tickable column in the Access Map,
 * so nothing is left that is visible-but-unreachable.
 *
 * ⚠️ THEY ARE STILL OFF BY DEFAULT. GRANT_ONLY_SECTIONS keeps every role template, tier bundle and
 * blanket from setting them — which is what the old keyless design was protecting, and the reason a
 * key could not simply be invented for them before. Only a hand-tick grants one now.
 *
 * The mechanism stays because the next section that genuinely cannot be delegated will need it, and
 * because an empty list is what tells a reader the question was asked and answered.
 */
export const LOCKED_SIDEBAR_SECTIONS: readonly LockedSidebarSection[] = []

/**
 * Permission groups that exist in the registry but that no page honours, because a LOCKED section above
 * replaces them. The Access Map drops them as tickable columns so a tick can no longer pretend to grant.
 */
/*
 * ⚠️ EMPTY on purpose, and it must stay a real set rather than be deleted.
 *
 * It held 'insurance_analysis' until 2026-09-15. That section was replaced by three brand-owned ones
 * (kia.insurance / hyundai.insurance / platinum.insurance) which are ordinary grantable groups, so
 * nothing is locked-but-tickable any more. The mechanism stays because the next role-locked section
 * will need it, and because an empty set is what tells a reader the question was asked.
 */
export const GROUPS_REPLACED_BY_LOCKED_SECTIONS: ReadonlySet<string> = new Set([])

export function isLockedSectionKey(key: string): boolean {
  return key.startsWith(LOCKED_SECTION_KEY_PREFIX)
}
