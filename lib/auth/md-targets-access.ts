/**
 * MD + Developer ONLY — the /targets section, where the MD sets each branch's monthly sales and
 * service targets.
 *
 * ── WHY A HARDCODED ROLE GATE AND NOT A PERMISSION KEY ────────────────────────────────────────
 * The obvious approach — a `md_targets.view` permission left out of DEFAULT_VISIBLE_SECTIONS so it
 * is deny-by-default — does NOT deliver "only MD". Two roles would still receive it:
 *
 *   `admin` and `hr` are both `family: 'super'` in lib/permissions/tiers.ts, and buildTierRoleDefaults
 *   sets EVERY key true for a super family. RESTRICTED_DEFAULT_PERMISSION_KEYS is only consulted in
 *   the brand-default and global-access layers (lib/permissions/service.ts) — never against a tier
 *   grant. So deny-by-default is silently bypassed for them.
 *
 * Note `admin` is NOT in isSuperAdminRole either (lib/auth/roles.ts — that is `developer || md`
 * only), so it does not bypass gate FUNCTIONS. It only slips through the PERMISSION layer. A
 * constant the Access Map cannot reach is therefore the only gate that matches the requirement.
 *
 * This is the same pattern as /md-approvals, /data-health, CA and Restricted Analytics — see
 * lib/auth/restricted-analytics.ts, whose header records the same reasoning for its own sections.
 *
 * ⚠️ Because there is deliberately no permission key, this section has NO entry in SECTION_ROUTES.
 * Registering one would put a tickable row in the Access Map that does nothing, which
 * scripts/verify-guard-parity.ts flags as a standing NOTE.
 *
 * Client-safe: no server-only imports, so the sidebar and search components import it directly. The
 * page and every /api/targets route enforce the SAME predicate independently — the API is never
 * protected by the UI gate alone.
 *
 * To widen this later, add the role here and re-run `npm run verify:md-targets`. That is a
 * deliberate code change with a test behind it, which is the point.
 */

export const MD_TARGETS_ROLES = ['md', 'developer'] as const

/** Section hrefs behind this gate. Anything added here is hidden from every other role everywhere. */
export const MD_TARGETS_HREFS = ['/targets'] as const

export function canViewMdTargets(role?: string | null): boolean {
  return (MD_TARGETS_ROLES as readonly string[]).includes(
    String(role || '').toLowerCase().trim(),
  )
}

/** True when this href is the MD Targets section (or a path beneath it). */
export function isMdTargetsHref(href?: string | null): boolean {
  const value = String(href || '')
  return (MD_TARGETS_HREFS as readonly string[]).some(
    (allowed) => value === allowed || value.startsWith(`${allowed}/`),
  )
}
