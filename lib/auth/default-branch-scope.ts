import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'

/**
 * Which branches a login sees when it has NOT asked for a particular one.
 *
 * ── The distinction this module exists to make ────────────────────────────────────────────────
 * PERMISSION answers "may this person see branch X at all". DEFAULT answers "which branches do
 * they get when they simply open the page". For most roles the two are the same, so nothing needed
 * saying. For the MD they are NOT: an MD is permitted to see every branch, but an MD pinned to KIA
 * should LAND on KIA and reach the others through a deliberate control.
 *
 * Before this, every module conflated the two: the role short-circuited the branch filter, so the
 * permission answer ("all") silently became the default answer as well. Where a per-branch default
 * appeared to work (Purchase Orders), it worked only because the browser happened to send a branch
 * parameter — the server never derived one, and any caller that omitted it got everything.
 *
 * ⚠️ This is a DEFAULT, never a boundary. It must not be used to reject a request for another
 * branch: the MD is allowed to look, and the switcher depends on that. Keep the existing
 * permission checks exactly where they are.
 *
 * Client-safe: pure, no DB, no server-only imports — the sidebar and the branch switchers read it.
 */

/** `'all'` = no default narrowing (the login genuinely covers everything, or is unpinned). */
export type DefaultBranchScope = string[] | 'all'

/**
 * Split `users.brand` into the branches to land on.
 *
 * `users.brand` is not always one value: 'kia', 'kia,hyundai' and 'all' are all real shapes, and
 * a brand outside BRANCH_OPTIONS (or an empty column) is possible. Rules:
 *   - 'all', empty, or nothing recognisable  -> 'all' (do not narrow; there is no honest default)
 *   - one or more known brands               -> exactly those
 *
 * ⚠️ Unrecognisable input resolves to `'all'`, NOT to an empty list. An empty list would read as
 * "match no branch" and blank the page for a mis-pinned MD, which is the wrong failure for a
 * DEFAULT — the permission filter is what fails closed, not this.
 */
export function defaultBranchScopeFor(brand: string | null | undefined): DefaultBranchScope {
  if (hasAllBranchAccess(brand)) return 'all'
  const known = new Set<string>(BRANCH_OPTIONS.map((option) => option.value))
  const brands = String(brand || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => known.has(value))
  return brands.length ? brands : 'all'
}

/**
 * Resolve what a request should actually be scoped to.
 *
 * `requested` is whatever the caller asked for — a single brand, a comma list, 'all', or nothing.
 * Nothing means "use my default"; anything else is an explicit choice and wins, which is what makes
 * the branch switcher work. Unknown values are dropped rather than 400ing, because a stale bookmark
 * or a renamed brand should fall back to the default, not to an empty screen.
 */
export function resolveBranchScope(
  brand: string | null | undefined,
  requested: string | null | undefined,
): DefaultBranchScope {
  const asked = String(requested || '').trim().toLowerCase()
  if (!asked) return defaultBranchScopeFor(brand)
  if (asked === 'all') return 'all'

  const known = new Set<string>(BRANCH_OPTIONS.map((option) => option.value))
  const picked = asked
    .split(',')
    .map((value) => value.trim())
    .filter((value) => known.has(value))
  return picked.length ? picked : defaultBranchScopeFor(brand)
}

/** True when the scope covers everything, i.e. no branch predicate should be applied. */
export function isAllBranchScope(scope: DefaultBranchScope): scope is 'all' {
  return scope === 'all'
}
