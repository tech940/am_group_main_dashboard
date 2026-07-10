export const PETTY_CASH_REQUEST_STATUSES = [
  'draft',
  'submitted',
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
  'ea_approved',
  'ea_rejected',
  'md_approved',
  'md_rejected',
  'accounts_pending',
  'approved',
  'rejected',
  'cancelled',
] as const

export const PETTY_CASH_REQUEST_STAGES = ['draft', 'ea_approval', 'md_approval', 'accounts', 'allocated'] as const
export const PETTY_CASH_EXPENSE_STAGES = ['ea_approval', 'md_approval', 'accounts', 'ledger'] as const
export const PETTY_CASH_TOP_UP_THRESHOLD = 1000

export const PETTY_CASH_DEPARTMENT_OPTIONS = [
  'Sales',
  'Service',
] as const

export const PETTY_CASH_KIA_LOCATION_OPTIONS = ['JAMMU', 'UDHAMPUR'] as const
export const PETTY_CASH_KIA_DEALER_CODES = ['JK402', 'JK501'] as const
export const PETTY_CASH_KIA_DEALER_NAMES = ['KIA JAMMU', 'KIA UDHAMPUR'] as const
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

function stripBrandPrefix(label: string) {
  return label
    .replace(/^Hyundai\s+/i, '')
    .replace(/^Platinum\s+/i, '')
    .trim()
}

export function getPettyCashLocationOptions(branchId: string | null | undefined) {
  const normalizedBranch = String(branchId || '').trim().toLowerCase()

  if (normalizedBranch === 'hyundai') {
    return HYUNDAI_BRANCH_DEALERS.map((branch) => stripBrandPrefix(branch.label))
  }

  if (normalizedBranch === 'platinum') {
    return PLATINUM_BRANCH_DEALERS.map((branch) => stripBrandPrefix(branch.label))
  }

  if (normalizedBranch === 'kia') {
    // Banihal is a Petty-Cash-only location (no DMS dealer code), so it is added
    // here rather than in KIA_BRANCH_DEALERS to avoid affecting dealer mapping.
    return [...KIA_BRANCH_DEALERS.map((branch) => branch.label), 'Banihal']
  }

  return ['Main Location']
}

// Every petty-cash location across all branches (KIA incl. Banihal, Hyundai, Platinum) — used to
// seed the cross-branch Location filters so every location is always selectable, even before any
// expense/allocation exists for it (e.g. a freshly added location like Banihal with no data yet).
export function getAllPettyCashLocationOptions() {
  return Array.from(new Set([
    ...getPettyCashLocationOptions('kia'),
    ...getPettyCashLocationOptions('hyundai'),
    ...getPettyCashLocationOptions('platinum'),
  ]))
}

export function getPettyCashStatusLabel(status: string | null | undefined) {
  if (!status) return 'Unknown'
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
import { HYUNDAI_BRANCH_DEALERS } from '@/lib/hyundai/dealer-branch'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { PLATINUM_BRANCH_DEALERS } from '@/lib/platinum/dealer-branch'
