/**
 * EA + MD + Accounts + Developer ONLY — the /bank-sanctions section: the group's bank credit
 * facilities, limits, outstandings and security details.
 *
 * ── WHY A HARDCODED ROLE CONSTANT AND NOT A PERMISSION KEY ────────────────────────────────────
 * The same reasoning proven on /targets: a deny-by-default permission key would still reach
 * `admin` and `hr`, because both are `family: 'super'` in lib/permissions/tiers.ts and the super
 * tier bundle sets every key true without consulting RESTRICTED_DEFAULT_PERMISSION_KEYS. This data
 * is the group's borrowing position — bank limits, collateral, guarantors — so "exactly these four
 * roles" has to mean exactly these four, and only a constant the Access Map cannot reach does that.
 *
 * ⚠️ No SECTION_ROUTES entry, deliberately: registering one creates a tickable-but-inert Access Map
 * row that scripts/verify-guard-parity.ts flags.
 *
 * ⚠️ `md` and `developer` are isSuperAdminRole and short-circuit canUserAccessSection before this
 * predicate runs; they are listed here anyway so the page/API gates (which do NOT have that
 * short-circuit) admit them through the same single test.
 *
 * Client-safe: no server-only imports — the sidebar and search import this directly. Every
 * /api/bank-sanctions route enforces the identical predicate via lib/bank-sanctions/api-guard.ts.
 *
 * The Google Sheet this section replaces had no access control at all beyond a delete password
 * hardcoded in client-side JavaScript. That is the bar being cleared here.
 */

export const BANK_SANCTIONS_ROLES = ['ea', 'md', 'accounts', 'developer'] as const

export const BANK_SANCTIONS_HREFS = ['/bank-sanctions'] as const

export function canViewBankSanctions(role?: string | null): boolean {
  return (BANK_SANCTIONS_ROLES as readonly string[]).includes(
    String(role || '').toLowerCase().trim(),
  )
}

/** True when this href is the Bank Sanctions section (or a path beneath it). */
export function isBankSanctionsHref(href?: string | null): boolean {
  const value = String(href || '')
  return (BANK_SANCTIONS_HREFS as readonly string[]).some(
    (allowed) => value === allowed || value.startsWith(`${allowed}/`),
  )
}
