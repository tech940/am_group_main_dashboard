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
 * `process_coordinator` (PC) was added 2026-08-24: it opens the section but, like EA and Accounts,
 * only ever sees its own branches — see canViewAllBankSanctionBranches below.
 *
 * The Google Sheet this section replaces had no access control at all beyond a delete password
 * hardcoded in client-side JavaScript. That is the bar being cleared here.
 */

export const BANK_SANCTIONS_ROLES = ['ea', 'md', 'accounts', 'developer', 'process_coordinator'] as const

export const BANK_SANCTIONS_HREFS = ['/bank-sanctions'] as const

export function canViewBankSanctions(
  role?: string | null,
  permissionMap?: Record<string, boolean> | null
): boolean {
  const r = String(role || '').toLowerCase().trim()
  if ((BANK_SANCTIONS_ROLES as readonly string[]).includes(r)) return true
  if (permissionMap && permissionMap['bank_sanctions.view'] === true) return true
  return false
}

/** True when this href is the Bank Sanctions section (or a path beneath it). */
export function isBankSanctionsHref(href?: string | null): boolean {
  const value = String(href || '')
  return (BANK_SANCTIONS_HREFS as readonly string[]).some(
    (allowed) => value === allowed || value.startsWith(`${allowed}/`),
  )
}

/**
 * ── Brand scoping (migration 0046) ────────────────────────────────────────────────────────────
 *
 * Section access (above) answers "may you open /bank-sanctions at all". This answers the separate
 * question "WHICH facilities may you see once inside" — a KIA login must not read Hyundai's bank
 * position, and neither may read the holding company's.
 *
 * Two tiers, deliberately:
 *   1. MD + Developer, BY ROLE — the whole register, brand-scoped rows AND group-level ones.
 *   2. everyone else (EA, Accounts) — only facilities whose `branch_code` is one of the brands
 *      their admin-panel assignment grants.
 *
 * ⚠️ A group-level facility (branch_code IS NULL) is visible to tier 1 ONLY — including for a login
 * assigned 'all'. 'all' means "every BRAND", and the group's own borrowing (Jammu Auto Mart alone is
 * Rs59.86 Cr, the largest position in the register) is not a brand. This is the explicit product
 * decision of 2026-08-24, and it is why the NULL case is handled separately everywhere rather than
 * being folded into an inArray.
 */
export const BANK_SANCTIONS_ALL_BRAND_ROLES = ['md', 'developer'] as const

/**
 * Sees every facility, group-level rows included. Role-based only — an assignment cannot grant it.
 *
 * ⚠️ This deliberately does NOT consult `hasGlobalAccessRole` / GLOBAL_ACCESS_ROLE_VALUES
 * (lib/auth/roles.ts), which contains ea, eba, ed, edp, hr, ceo AND process_coordinator. Those roles
 * see every branch in other modules; here they must not. Wiring that list in — the obvious-looking
 * "consistency" fix — would hand every one of them the whole group's bank position, including the
 * Rs77.56 Cr of holding-company borrowing that is meant for MD and Developer alone.
 */
export function canViewAllBankSanctionBranches(role?: string | null): boolean {
  return (BANK_SANCTIONS_ALL_BRAND_ROLES as readonly string[])
    .includes(String(role || '').toLowerCase().trim())
}

/**
 * The brands this login may read, given `users.brand`.
 *
 * Returns `'all-brands'` for an 'all' assignment — every brand-coded facility, still NOT the
 * group-level ones. Callers must handle that token explicitly; it is a distinct case from a brand
 * list precisely so the group-level exclusion cannot be lost in a spread.
 *
 * Splits on comma like every other module ('kia,hyundai' is a real shape here), and filters through
 * the canonical brand list so junk yields [] — i.e. it fails CLOSED.
 */
export function bankSanctionBrandsFor(brand?: string | null): string[] | 'all-brands' {
  const raw = String(brand || '').trim().toLowerCase()
  if (raw === 'all') return 'all-brands'
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => (BANK_SANCTION_BRANDS as readonly string[]).includes(value))
}

/** The brand values a facility may legitimately carry — the same list as lib/branches.ts. */
export const BANK_SANCTION_BRANDS = [
  'kia', 'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'triumph', 'bajaj', 'mg',
] as const

/** Client-safe mirror of the server filter — used for labels, never as the only gate. */
export function canSeeBankSanctionRow(
  role: string | null | undefined,
  brand: string | null | undefined,
  rowBranchCode: string | null | undefined,
): boolean {
  if (canViewAllBankSanctionBranches(role)) return true
  const code = String(rowBranchCode || '').trim().toLowerCase()
  if (!code) return false // group-level — tier 1 only
  const brands = bankSanctionBrandsFor(brand)
  return brands === 'all-brands' ? true : brands.includes(code)
}
