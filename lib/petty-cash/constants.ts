export const PETTY_CASH_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'ed_pending',
  'ed_approved',
  'ed_on_hold',
  'ed_rejected',
  'ea_pending',
  'ea_approved',
  'ea_on_hold',
  'ea_rejected',
  'md_pending',
  'md_approved',
  'md_on_hold',
  'md_rejected',
  'accounts_pending',
  'accounts_on_hold',
  'approved',
  'rejected',
  'cancelled',
] as const

export const PETTY_CASH_EXPENSE_STATUSES = [
  'pending',
  'ed_pending',
  'ed_approved',
  'ed_rejected',
  'ea_approved',
  'ea_rejected',
  'md_approved',
  'md_rejected',
  'accounts_pending',
  'approved',
  'rejected',
  'cancelled',
] as const

export const PETTY_CASH_KIA_TOP_UP_THRESHOLD = 1000
export const PETTY_CASH_DEFAULT_TOP_UP_THRESHOLD = 10000
export const PETTY_CASH_TOP_UP_THRESHOLD = PETTY_CASH_DEFAULT_TOP_UP_THRESHOLD

/**
 * Returns the minimum remaining balance required to unlock a new petty cash order / top-up request.
 * - AM Kia: ₹1,000
 * - All other branches (Hyundai, Platinum, MG, etc.): ₹10,000
 */
export function getPettyCashTopUpThreshold(branchId?: string | null): number {
  if (!branchId) return PETTY_CASH_DEFAULT_TOP_UP_THRESHOLD
  const normalized = branchId.trim().toLowerCase()
  return normalized === 'kia' ? PETTY_CASH_KIA_TOP_UP_THRESHOLD : PETTY_CASH_DEFAULT_TOP_UP_THRESHOLD
}

export const PETTY_CASH_DEPARTMENT_OPTIONS = [
  'Sales',
  'Service',
] as const

// (Removed: three hardcoded KIA location/dealer-code lists that nothing imported. They were a
// standing invitation to add a fourth copy of the branch list — see the registry below.)
export const PETTY_CASH_PAYMENT_TYPES = ['CREDIT', 'CASH', 'CHEQUE', 'ONLINE TRANSFER', 'Credit Card'] as const

export const PETTY_CASH_DEFAULT_CATEGORY_SLUGS = [
  'fuel-travel',
  'office-supplies',
  'repairs-maintenance',
  'customer-hospitality',
  'staff-welfare',
  'other',
] as const

export type PettyCashRequestStatus = typeof PETTY_CASH_REQUEST_STATUSES[number]
export type PettyCashExpenseStatus = typeof PETTY_CASH_EXPENSE_STATUSES[number]

export function isPettyCashRequestStatus(value: string): value is PettyCashRequestStatus {
  return (PETTY_CASH_REQUEST_STATUSES as readonly string[]).includes(value)
}

export function isPettyCashExpenseStatus(value: string): value is PettyCashExpenseStatus {
  return (PETTY_CASH_EXPENSE_STATUSES as readonly string[]).includes(value)
}

/*
 * ============================================================================
 * PETTY CASH BRANCH REGISTRY — the ONE place to switch a brand on.
 * ============================================================================
 *
 * Terminology, because the two words are used inconsistently elsewhere:
 *   - `branchId` here is the BRAND ('kia', 'tata', 'hyundai', …) — lib/branches.ts.
 *   - a "location" is the individual dealership ('Jammu', 'Udhampur', 'Banihal'),
 *     stored on the request itself as requestForm.location.
 *
 * This used to be an if-chain over three brand names, and the brand list was
 * repeated in THREE places — the chain, getAllPettyCashLocationOptions(), and
 * stripBrandPrefix(). Adding a branch meant finding all three; missing the second
 * silently dropped the new brand's locations out of every cross-branch filter
 * while everything still compiled. Everything below now derives from this one
 * object, so adding a branch is a data change with no way to half-do it.
 *
 * To add a brand: add one entry. Nothing else in petty cash needs to change.
 */
type PettyCashBranchConfig = {
  /** Dealerships from the brand's own registry — the source of truth for real outlets. */
  dealers: () => string[]
  /** Leading brand word to drop from those labels ("Hyundai Jammu" -> "Jammu"). */
  stripPrefix?: string
  /**
   * Locations that take petty cash but have no DMS dealer code, so they cannot live
   * in the brand's dealer registry without corrupting dealer mapping (e.g. Banihal).
   */
  extraLocations?: string[]
}

const PETTY_CASH_BRANCH_LOCATIONS: Record<string, PettyCashBranchConfig> = {
  kia: {
    dealers: () => KIA_BRANCH_DEALERS.map((branch) => branch.label),
    extraLocations: ['Banihal'],
  },
  hyundai: {
    dealers: () => HYUNDAI_BRANCH_DEALERS.map((branch) => branch.label),
    stripPrefix: 'Hyundai',
  },
  platinum: {
    dealers: () => PLATINUM_BRANCH_DEALERS.map((branch) => branch.label),
    stripPrefix: 'Platinum',
  },
}

function stripBrandPrefix(label: string, prefix?: string) {
  // Plain prefix check rather than a RegExp: inside a template literal `\s` collapses to `s`, so the
  // regex form silently compiled to /^Hyundais+/ and stripped nothing. No escaping, no hazard.
  const trimmed = label.trim()
  if (!prefix) return trimmed
  const lead = `${prefix} `
  return trimmed.toLowerCase().startsWith(lead.toLowerCase())
    ? trimmed.slice(lead.length).trim()
    : trimmed
}

function normalizeBranch(branchId: string | null | undefined) {
  return String(branchId || '').trim().toLowerCase()
}

/**
 * Has petty cash been switched on for this brand?
 *
 * Callers should ASK before rendering a location picker. The old code answered an
 * unconfigured brand with `['Main Location']` — a plausible-looking option that would
 * have been written into requestForm.location and lived in the ledger forever. Verified
 * against live data before changing it: 0 rows carry that literal, so nothing depends on it.
 */
export function isPettyCashConfiguredForBranch(branchId: string | null | undefined) {
  return Boolean(PETTY_CASH_BRANCH_LOCATIONS[normalizeBranch(branchId)])
}

/** Brands petty cash is currently switched on for. */
export function getPettyCashConfiguredBranches() {
  return Object.keys(PETTY_CASH_BRANCH_LOCATIONS)
}

/**
 * The concrete brands a login is pinned to.
 *
 * `users.brand` is NOT always one brand — a person shared between dealerships carries a
 * comma-separated assignment like 'hyundai,platinum'. Every other module already splits it:
 * canAccessBrand (lib/auth/brand-access.ts:14), lib/admin/effective-access.ts:87,
 * lib/delegation/access.ts:26. Petty cash was the last place still comparing the raw string with
 * `===`, so a multi-brand user matched NOTHING — no rows on any tab, and 'Forbidden branch' the
 * moment they tried to create anything.
 *
 * Filtered through isBranchValue, so 'all', null and junk all yield [] — the same "matches nothing"
 * the old `appUser.brand || ''` produced, i.e. it fails CLOSED. Callers that mean "sees everything"
 * must ask hasPettyCashAllBranchAccess FIRST; this function never says yes to that.
 *
 * The `.trim()` is safe rather than an access grant: verified against live data, no `users.brand`
 * value carries leading or trailing whitespace, so no login gains anything it did not already have.
 * Case is deliberately NOT normalised — 'KIA' matches nothing today and quietly widening that is
 * not this function's job.
 *
 * (The all-branch ROLE list below is a separate concern: it answers "who ignores assignments
 * entirely", this function answers "what did the assignment say".)
 */
/**
 * Roles that see EVERY petty-cash branch UNCONDITIONALLY — exactly MD and Developer.
 *
 * ⚠️ EA, EBA and ED were removed from this list on purpose (2026-08-24, product decision): branch
 * visibility for every other role now follows the ADMIN-PANEL ASSIGNMENT (`users.brand`). An EA
 * pinned to 'kia' sees KIA only; an EA assigned 'kia,hyundai' sees both; an EA assigned 'all'
 * still sees everything — via hasAllBranchAccess, not via their role. The assignment is the single
 * lever, which is what makes Admin → Users the answer to every "who can see what" question.
 *
 * Lives HERE (client-safe) rather than in access.ts because the workspace needs the same predicate
 * for its labels, filters and brand switcher — and access.ts value-imports the whole DB schema, so
 * the client must never import it. One list, both sides; this is the drift that produced the
 * sidebar/page desync incidents.
 */
/**
 * Roles that SUBMIT petty cash, and therefore see ONLY WHAT THEY THEMSELVES SUBMITTED.
 *
 * A branch admin is a custodian of their own float, not a supervisor of the branch: before
 * 2026-08-24 all three KIA branch admins could see each other's 55/55/75 expenses (185 rows each)
 * simply because they shared a brand. Approvers (EA/ED/MD/accounts) still see the whole branch —
 * they cannot review a queue they cannot see — but a submitter's view is now their own work only.
 *
 * ⚠️ This is NOT the same set as canCreatePettyCashRequest, which was widened to every role — an
 * EA or MD may now raise a request, and they still see the whole branch, which is correct for a
 * supervisor. "May create" and "sees only what they created" are genuinely different questions;
 * keep the two lists independent rather than deriving one from the other.
 */
export const PETTY_CASH_OWN_SUBMISSIONS_ONLY_ROLES = ['branch_admin', 'sales_manager'] as const

export function isPettyCashOwnSubmissionsOnlyRole(role: string | null | undefined): boolean {
  return (PETTY_CASH_OWN_SUBMISSIONS_ONLY_ROLES as readonly string[])
    .includes(String(role || '').trim().toLowerCase())
}

export const PETTY_CASH_ALL_BRANCH_ROLES = ['developer', 'md'] as const

export function isPettyCashAllBranchRole(role: string | null | undefined): boolean {
  return (PETTY_CASH_ALL_BRANCH_ROLES as readonly string[]).includes(String(role || '').trim().toLowerCase())
}

export function getPettyCashUserBrands(brand: string | null | undefined): string[] {
  return String(brand || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => isBranchValue(value))
}

/**
 * Why is this user's petty cash empty? One answer, computed one way.
 *
 *   'configured'   — they have at least one brand petty cash runs at (or they see every branch)
 *   'unassigned'   — no branch on their account at all; an admin has to set one
 *   'unconfigured' — assigned a real group brand petty cash was never switched on for
 *                    ('honda' = AM Diamond Honda, 'tata' = AM Tata)
 *
 * ⚠️ Do NOT ask isPettyCashConfiguredForBranch() the RAW `users.brand` string. It is an exact key
 * lookup, and the raw value is not always one brand — all three of these answered wrongly:
 *   'all'          -> false, so MDs and developers were told "not set up for Unassigned Branch"
 *   'kia,hyundai'  -> false, so a shared multi-brand login was told its own brands were
 *                     unconfigured AND had its create buttons disabled
 *   'honda'        -> false correctly, but the message was gated on being a CREATOR, so an EA
 *                     pinned to Honda got a dashboard of zeros with no explanation at all
 * Split first, then ask per brand. That is what this function does.
 */
export type PettyCashBrandStatus = 'configured' | 'unassigned' | 'unconfigured'

export function getPettyCashBrandStatus(
  brand: string | null | undefined,
  isAllBranchViewer: boolean,
): PettyCashBrandStatus {
  // An all-branch viewer is never "unconfigured" — they see every brand that exists.
  if (isAllBranchViewer) return 'configured'
  const brands = getPettyCashUserBrands(brand)
  if (brands.length === 0) return 'unassigned'
  return brands.some((value) => isPettyCashConfiguredForBranch(value)) ? 'configured' : 'unconfigured'
}

export function getPettyCashLocationOptions(branchId: string | null | undefined) {
  const config = PETTY_CASH_BRANCH_LOCATIONS[normalizeBranch(branchId)]
  // Empty, deliberately — see isPettyCashConfiguredForBranch. An unconfigured brand must
  // produce NO selectable location rather than a fake one.
  if (!config) return []
  return [
    ...config.dealers().map((label) => stripBrandPrefix(label, config.stripPrefix)),
    ...(config.extraLocations ?? []),
  ]
}

/**
 * Every petty-cash location across every configured brand — seeds the cross-branch Location
 * filters so a location is selectable even before it has any data (a freshly added outlet).
 * Derived from the registry, so a new brand cannot be forgotten here.
 */
export function getAllPettyCashLocationOptions() {
  return Array.from(new Set(
    getPettyCashConfiguredBranches().flatMap((branchId) => getPettyCashLocationOptions(branchId)),
  ))
}

/**
 * The one user-facing name for a status. Delegates to STAGE_INFO so there is a single authored
 * vocabulary. This used to be `split('_')` + capitalise, which is why pills read "Md Pending" and
 * "Ea On Hold" — a database value with a haircut, on the screen users read most.
 */
export function getPettyCashStatusLabel(status: string | null | undefined) {
  return getPettyCashStageInfo(status).pillLabel
}
import { getPettyCashStageInfo } from './status-tracking'
import { HYUNDAI_BRANCH_DEALERS } from '@/lib/hyundai/dealer-branch'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { PLATINUM_BRANCH_DEALERS } from '@/lib/platinum/dealer-branch'
// lib/branches.ts is a pure constants module (no 'server-only', no db imports), so importing it
// here keeps this file safe for the 'use client' workspace that already consumes it.
import { isBranchValue } from '@/lib/branches'
