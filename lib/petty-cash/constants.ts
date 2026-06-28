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
  'HR',
  'ADMIN',
  'SALES',
  'SERVICE',
  'H PROMISE',
  'BODY SHOP',
  'ACCOUNTS',
  'CRM',
  'INSURANCE',
  'EDP / IT',
  'SPARE PARTS',
  'SALES & SERVICE',
  'Accessories',
  'EMI',
  'NEW JOINING',
  'LABOUR CHARGES',
  'OTHER',
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

export function getPettyCashStatusLabel(status: string | null | undefined) {
  if (!status) return 'Unknown'
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
