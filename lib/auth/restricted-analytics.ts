/**
 * The role gate for Call Analysis: a fixed list the Access Map cannot reach.
 *
 * WHY A HARDCODED ROLE GATE AND NOT A PERMISSION:
 * A permission key is grantable to any user or role from the Access Map, so "only these roles" would
 * hold exactly until someone ticked a box. This section plays back RECORDINGS OF CUSTOMER CALLS and
 * shows unmasked customer numbers, so who may open it is a standing decision rather than a setting —
 * the same pattern as Vehicle Tracker, CA and Booking Payment History.
 *
 * ── History, because the name and the comment have both been wrong before ────────────────────────
 * This started as 'md' + 'developer' only and as the shared gate for Call Analysis AND Insurance
 * Analysis. Two things changed and the comment did not follow either:
 *   - the list was widened twice, deliberately, to the five roles below;
 *   - Insurance Analysis was removed on 2026-09-15 and replaced by three brand-owned sections, each
 *     an ordinary grantable group (`<brand>.insurance.view`). The whole-book premium argument no
 *     longer applies, because there is no longer a screen that shows the whole book.
 * So this now gates ONE section. Call Analysis has its own copy of the identical role list in
 * lib/callyzer/access.ts; the two must be changed together, and neither is the other's source.
 *
 * Client-safe: no server-only imports, so the sidebar and search components can import it directly.
 * Every server route re-checks with this same predicate — the API is never protected by the UI alone.
 */

export const RESTRICTED_ANALYTICS_ROLES = ['md', 'developer', 'assistant_manager', 'ea', 'eba'] as const

/** Section hrefs behind this gate. Anything added here is hidden from every other role everywhere. */
export const RESTRICTED_ANALYTICS_HREFS = ['/call-analysis'] as const

export function canViewRestrictedAnalytics(role?: string | null): boolean {
  return (RESTRICTED_ANALYTICS_ROLES as readonly string[]).includes(
    String(role || '').toLowerCase().trim(),
  )
}

/** True when this href is one of the restricted-analytics sections. */
export function isRestrictedAnalyticsHref(href?: string | null): boolean {
  const value = String(href || '')
  return (RESTRICTED_ANALYTICS_HREFS as readonly string[]).some(
    (h) => value === h || value.startsWith(`${h}/`),
  )
}
