import { and, eq, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { financeOrders } from '@/lib/db/schema'
import { getUserBranchLabel, hasAllBranchAccess } from '@/lib/branches'

type FinanceOrderRecord = typeof financeOrders.$inferSelect
type FinanceRole = AppUser['role']

export const FINANCE_ORDER_STATUSES = [
  'draft',
  'awaiting_accounts_verification',
  'accounts_verified',
  'accounts_denied',
  'accounts_on_hold',
  'awaiting_ea_approval',
  'ea_approved',
  'ea_denied',
  'ea_on_hold',
  'awaiting_md_approval',
  'md_approved',
  'md_denied',
  'md_on_hold',
  'completed',
  'cancelled',
] as const

export const FINANCE_ORDER_STAGES = [
  'finance_head_submission',
  'accounts_verification',
  'ea_approval',
  'md_approval',
  'completed',
] as const

export function isFinanceOrderStatus(value: string): value is typeof FINANCE_ORDER_STATUSES[number] {
  return (FINANCE_ORDER_STATUSES as readonly string[]).includes(value)
}

export function isFinanceOrderStage(value: string): value is typeof FINANCE_ORDER_STAGES[number] {
  return (FINANCE_ORDER_STAGES as readonly string[]).includes(value)
}

export function canAccessFinanceOrders(role: FinanceRole | null | undefined) {
  return role === 'admin' || role === 'super_admin' || role === 'ceo' || role === 'md' || role === 'ea' || role === 'accounts' || role === 'finance_head'
}

export function canCreateFinanceOrders(role: FinanceRole | null | undefined) {
  return role === 'admin' || role === 'super_admin' || role === 'finance_head'
}

export function canEditFinanceOrder(role: FinanceRole | null | undefined, order: Pick<FinanceOrderRecord, 'status' | 'createdBy'>, userId: string) {
  return canCreateFinanceOrders(role)
    && order.createdBy === userId
    && (order.status === 'draft' || order.status === 'accounts_on_hold' || order.status === 'ea_on_hold' || order.status === 'md_on_hold')
}

export function canVerifyFinanceAccounts(role: FinanceRole | null | undefined) {
  return role === 'admin' || role === 'super_admin' || role === 'accounts'
}

export function canApproveFinanceEa(role: FinanceRole | null | undefined) {
  return role === 'admin' || role === 'super_admin' || role === 'ea'
}

export function canApproveFinanceMd(role: FinanceRole | null | undefined) {
  return role === 'admin' || role === 'super_admin' || role === 'md'
}

function getFinanceBranchFilter(appUser: AppUser) {
  if (hasAllBranchAccess(appUser.brand)) return null

  const branch = appUser.brand || ''
  const branchLabel = getUserBranchLabel(branch)
  return or(
    eq(financeOrders.dealer, branch),
    eq(financeOrders.dealer, branchLabel)
  )
}

export function getFinanceOrderVisibilityFilter(appUser: AppUser): SQL<unknown> {
  const baseFilters: SQL<unknown>[] = [isNull(financeOrders.deletedAt)]

  switch (appUser.role) {
    case 'admin':
    case 'super_admin':
      return and(...baseFilters)!
    case 'ceo':
    case 'md':
    case 'ea':
    case 'accounts': {
      const branchFilter = getFinanceBranchFilter(appUser)
      return branchFilter ? and(...baseFilters, branchFilter)! : and(...baseFilters)!
    }
    case 'finance_head':
      return and(...baseFilters, eq(financeOrders.createdBy, appUser.id))!
    default:
      return and(...baseFilters, eq(financeOrders.id, '00000000-0000-0000-0000-000000000000'))!
  }
}

export function canReadFinanceOrder(appUser: AppUser, order: Pick<FinanceOrderRecord, 'createdBy' | 'dealer'>) {
  if (!canAccessFinanceOrders(appUser.role)) return false
  if (appUser.role === 'finance_head') return order.createdBy === appUser.id
  if (
    (appUser.role === 'ceo' || appUser.role === 'md' || appUser.role === 'ea' || appUser.role === 'accounts')
    && !hasAllBranchAccess(appUser.brand)
  ) {
    const branchLabel = getUserBranchLabel(appUser.brand)
    return order.dealer === appUser.brand || order.dealer === branchLabel
  }
  return true
}

export function getFinanceApprovalFilter(role: FinanceRole | null | undefined, filter: string | null) {
  if (role !== 'ea' && role !== 'md' && role !== 'accounts' && role !== 'admin' && role !== 'super_admin') return null

  if (filter === 'hold') {
    if (role === 'accounts') return eq(financeOrders.status, 'accounts_on_hold')
    return role === 'md' ? eq(financeOrders.status, 'md_on_hold') : or(eq(financeOrders.status, 'ea_on_hold'), eq(financeOrders.status, 'md_on_hold'))
  }

  if (filter === 'rejected') {
    if (role === 'accounts') return eq(financeOrders.status, 'accounts_denied')
    return role === 'md' ? eq(financeOrders.status, 'md_denied') : or(eq(financeOrders.status, 'ea_denied'), eq(financeOrders.status, 'md_denied'))
  }

  if (filter === 'approved') {
    if (role === 'accounts') return eq(financeOrders.accountsVerificationStatus, 'received')
    return role === 'md' ? eq(financeOrders.mdApprovalStatus, 'approved') : eq(financeOrders.eaApprovalStatus, 'approved')
  }

  if (filter === 'completed') {
    return eq(financeOrders.status, 'completed')
  }

  if (filter === 'pending') {
    if (role === 'accounts') return eq(financeOrders.status, 'awaiting_accounts_verification')
    return role === 'md' ? eq(financeOrders.status, 'awaiting_md_approval') : eq(financeOrders.status, 'awaiting_ea_approval')
  }

  return null
}
