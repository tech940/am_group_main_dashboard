// Client-safe role gating for the Delegation Tasks section.
// Imported by BOTH the React client (to show/hide the Delegate button + assignee picker) and the
// server (API routes + lib) so the same rules are enforced in the UI and re-enforced on the backend.
//
// IMPORTANT: delegation is gated by ROLE, not by a `.view`/`.create` permission. The section is
// broadly visible (in DEFAULT_VISIBLE_SECTIONS) so every user can see their own task inbox — a
// permission check could not restrict WHO delegates. This mirrors how KIA delivery/allot are role-
// gated in lib/kia/workflow-access.ts, not permission-gated.

function norm(role?: string | null) {
  return String(role || '').trim().toLowerCase()
}

// ── Brand scoping ─────────────────────────────────────────────────────────────────────────────────
// A delegator only sees + assigns within their own brand(s); a GROUP-WIDE delegator (brand 'all', or
// the developer/system role) sees every brand and gets the cross-branch rollup.
//
// ⚠️ This deliberately keys off `users.brand`, NOT the role. Everywhere else in the app `md` is global
// by role (isSuperAdminRole / canAccessBrand short-circuit on it) — but the requirement here is a
// brand-scoped MD (e.g. a KIA MD sees only KIA), so those helpers must NOT be reused. A group MD is
// distinguished by brand='all', exactly as the data models it (KIA MD = md/brand=kia; group MD =
// md/brand=all).

/** Split a `users.brand` value ('kia' | 'all' | 'hyundai,tata') into lowercased brand tokens. */
export function parseBrands(brand?: string | null): string[] {
  return String(brand || '').split(',').map((b) => b.trim().toLowerCase()).filter(Boolean)
}

/** The CONCRETE brands (excluding the 'all' marker) a user belongs to. */
export function concreteBrands(brand?: string | null): string[] {
  return parseBrands(brand).filter((b) => b !== 'all')
}

/** Group-wide = sees/assigns across ALL brands: developer/admin roles, or the 'all' brand marker. */
export function isGroupWideDelegation(user: { role?: string | null; brand?: string | null }): boolean {
  const role = norm(user.role)
  if (role === 'developer' || role === 'admin') return true
  return parseBrands(user.brand).includes('all')
}

/**
 * Can a scoped delegator (their concrete brands) assign to a candidate with this brand? True if they
 * share a brand OR the candidate is shared 'all'-brand staff (EA / accounts / chairman office), which
 * serve every brand. (User decision: brand staff + shared 'all' staff are assignable.)
 */
export function isAssignableUnderBrands(candidateBrand: string | null | undefined, delegatorBrands: string[]): boolean {
  const cb = parseBrands(candidateBrand)
  if (cb.includes('all')) return true
  return cb.some((b) => delegatorBrands.includes(b))
}

/**
 * The brand a NEW task belongs to (for scoping + the per-branch rollup): the delegator's primary
 * concrete brand, else the assignee's. A group MD (brand='all') has no concrete brand, so the task
 * takes the assignee's branch; a KIA MD's tasks are always 'kia'.
 */
export function resolveTaskBrand(delegatorBrand?: string | null, assigneeBrand?: string | null): string | null {
  return concreteBrands(delegatorBrand)[0] || concreteBrands(assigneeBrand)[0] || null
}

// Leadership allowed to create, manage, and delegate tasks (MD, EA, Developer, Admin).
const DELEGATOR_ROLES = new Set([
  'admin', 'developer', 'md', 'ea', 'eba',
])

/** May create/assign a task, and act on it as the delegator (reassign / reopen / cancel / edit). */
export function canDelegateTasks(role?: string | null): boolean {
  return DELEGATOR_ROLES.has(norm(role))
}

/**
 * May see EVERY task across EVERY brand — group-wide viewers only (see isGroupWideDelegation). A
 * brand-scoped delegator sees their brand's tasks (enforced in lib/delegation/tasks.ts scopeFilter);
 * a pure assignee sees only their own. Kept as a named alias so call sites read intentionally.
 */
export function canViewAllDelegationTasks(user: { role?: string | null; brand?: string | null }): boolean {
  return isGroupWideDelegation(user)
}
