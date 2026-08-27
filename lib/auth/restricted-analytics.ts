/**
 * MD + Developer ONLY. The two sections whose data is too sensitive to be widened by anyone.
 *
 * WHY A HARDCODED ROLE GATE AND NOT A PERMISSION:
 * A permission key (`insurance_analysis.view`) is grantable to any user or role from the Access Map,
 * so "only MD and Developer" would hold exactly until someone ticked a box. These two sections carry
 * customer call recordings, unmasked customer phone numbers, and whole-book insurance premium and
 * policy data. The requirement is two roles, permanently, so the gate is a constant that the Access
 * Map cannot reach — the same pattern as Vehicle Tracker, CA and Booking Payment History.
 *
 * ONE gate for both sections on purpose: the sidebar and BOTH search surfaces (the /search page and
 * the global search dialog) import from here, so there is no second copy to drift out of step. That
 * drift is a real failure mode in this repo — see the access guard-desync fix, where the sidebar
 * showed an item the page then refused to open.
 *
 * Client-safe: no server-only imports, so the sidebar and search components can import it directly.
 * Server routes enforce the same set independently via isSuperAdminRole(), which is the identical
 * two-role test — the API is never protected by the UI gate alone.
 */

export const RESTRICTED_ANALYTICS_ROLES = ['md', 'developer', 'assistant_manager', 'ea', 'eba'] as const

/** Section hrefs behind this gate. Anything added here is hidden from every other role everywhere. */
export const RESTRICTED_ANALYTICS_HREFS = ['/call-analysis', '/insurance'] as const

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
