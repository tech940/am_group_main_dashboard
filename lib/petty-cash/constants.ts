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

export const PETTY_CASH_REQUEST_STAGES = ['draft', 'ed_approval', 'ea_approval', 'md_approval', 'accounts', 'allocated'] as const
export const PETTY_CASH_EXPENSE_STAGES = ['ed_approval', 'ea_approval', 'md_approval', 'accounts', 'ledger'] as const
export const PETTY_CASH_TOP_UP_THRESHOLD = 1000

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
