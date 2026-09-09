import { brandHasEd } from '@/lib/approvals/first-stage-approver'
import { getPettyCashStageInfo } from './status-tracking'
import { HYUNDAI_BRANCH_DEALERS } from '@/lib/hyundai/dealer-branch'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { PLATINUM_BRANCH_DEALERS } from '@/lib/platinum/dealer-branch'
import { MG_BRANCH_DEALERS } from '@/lib/mg/dealer-branch'
import { isBranchValue } from '@/lib/branches'

export const PETTY_CASH_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'gsm_pending',
  'gsm_approved',
  'gsm_on_hold',
  'gsm_rejected',
  'ceo_pending',
  'ceo_approved',
  'ceo_on_hold',
  'ceo_rejected',
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

export const PETTY_CASH_PENDING_STATUSES = PETTY_CASH_REQUEST_STATUSES.filter(
  (status) => status === 'submitted' || status.endsWith('_pending') || status.endsWith('_on_hold'),
) as readonly string[]

export const PETTY_CASH_EXPENSE_STATUSES = [
  'pending',
  'gsm_pending',
  'gsm_approved',
  'gsm_rejected',
  'ceo_pending',
  'ceo_approved',
  'ceo_rejected',
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

export function getPettyCashTopUpThreshold(branchId?: string | null): number {
  if (!branchId) return PETTY_CASH_DEFAULT_TOP_UP_THRESHOLD
  const normalized = branchId.trim().toLowerCase()
  return normalized === 'kia' ? PETTY_CASH_KIA_TOP_UP_THRESHOLD : PETTY_CASH_DEFAULT_TOP_UP_THRESHOLD
}

export const PETTY_CASH_DEPARTMENT_OPTIONS = [
  'Sales',
  'Service',
] as const

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

type PettyCashBranchConfig = {
  dealers: () => string[]
  stripPrefix?: string
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
    extraLocations: ['Supwal', 'R S Pura'],
  },
  platinum: {
    dealers: () => PLATINUM_BRANCH_DEALERS.map((branch) => branch.label),
    stripPrefix: 'Platinum',
  },
  mg: {
    dealers: () => MG_BRANCH_DEALERS.map((branch) => branch.label),
    stripPrefix: 'MG',
  },
}

function stripBrandPrefix(label: string, prefix?: string) {
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

export function isPettyCashConfiguredForBranch(branchId: string | null | undefined) {
  return Boolean(PETTY_CASH_BRANCH_LOCATIONS[normalizeBranch(branchId)])
}

export function getPettyCashConfiguredBranches() {
  return Object.keys(PETTY_CASH_BRANCH_LOCATIONS)
}

export const PETTY_CASH_OWN_SUBMISSIONS_ONLY_ROLES = [
  'branch_admin',
  'sales_manager',
  'general_manager',
  'service_general_manager',
] as const

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

export type PettyCashBrandStatus = 'configured' | 'unassigned' | 'unconfigured'

export function getPettyCashBrandStatus(
  brand: string | null | undefined,
  isAllBranchViewer: boolean,
): PettyCashBrandStatus {
  if (isAllBranchViewer) return 'configured'
  const brands = getPettyCashUserBrands(brand)
  if (brands.length === 0) return 'unassigned'
  return brands.some((value) => isPettyCashConfiguredForBranch(value)) ? 'configured' : 'unconfigured'
}

export function getPettyCashLocationOptions(branchId: string | null | undefined) {
  const config = PETTY_CASH_BRANCH_LOCATIONS[normalizeBranch(branchId)]
  if (!config) return []
  return [
    ...config.dealers().map((label) => stripBrandPrefix(label, config.stripPrefix)),
    ...(config.extraLocations ?? []),
  ]
}

export function getAllPettyCashLocationOptions() {
  return Array.from(new Set(
    getPettyCashConfiguredBranches().flatMap((branchId) => getPettyCashLocationOptions(branchId)),
  ))
}

export function getPettyCashStatusLabel(status: string | null | undefined) {
  return getPettyCashStageInfo(status).pillLabel
}

export function pettyCashHasFirstStage(branchId: string | null | undefined): boolean {
  return brandHasEd(branchId)
}

export function pettyCashInitialStatus(branchId: string | null | undefined): 'ceo_pending' | 'ea_pending' {
  return pettyCashHasFirstStage(branchId) ? 'ceo_pending' : 'ea_pending'
}

export function pettyCashInitialStage(branchId: string | null | undefined): 'ceo_approval' | 'ea_approval' {
  return pettyCashHasFirstStage(branchId) ? 'ceo_approval' : 'ea_approval'
}

export type PettyCashApprovalStage =
  | 'gsm_approval' | 'ceo_approval' | 'ed_approval' | 'ea_approval' | 'md_approval' | 'accounts'

export function pettyCashStageForStatus(
  status: string | null | undefined,
  branchId?: string | null,
): PettyCashApprovalStage {
  const s = String(status ?? '').trim()
  if (s.startsWith('gsm_')) return 'gsm_approval'
  if (s.startsWith('ceo_')) return 'ceo_approval'
  if (s.startsWith('ed_') && s !== 'ed_approved') return 'ed_approval'
  if (s === 'ed_approved' || s === 'ceo_approved' || s === 'gsm_approved') return 'ea_approval'
  if (s.startsWith('ea_') && s !== 'ea_approved') return 'ea_approval'
  if (s === 'ea_approved' || s.startsWith('md_')) return 'md_approval'
  if (s === 'submitted') return pettyCashInitialStage(branchId)
  return 'accounts'
}

export function canApprovePettyCashStageRule(
  role: string | null | undefined,
  stage: string,
  hasFirstStage: boolean,
): boolean {
  const r = String(role ?? '').trim().toLowerCase()
  if (!r) return false
  if (r === 'developer' || r === 'admin') return true

  const isAccounts = r === 'accounts' || r === 'accounts_head' || r === 'accounts_team'
    || r === 'finance_head' || r === 'finance_team'

  switch (stage) {
    case 'gsm_approval':
      return false
    case 'ceo_approval':
    case 'ed_approval':
      if (!hasFirstStage) return false
      return r === 'ceo' || r === 'ed'
    case 'ea_approval':
      return r === 'ea' || r === 'eba'
    case 'md_approval':
      return r === 'md'
    case 'accounts':
      return isAccounts
    default:
      return false
  }
}
