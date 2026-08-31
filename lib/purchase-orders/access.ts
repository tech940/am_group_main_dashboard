import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess } from '@/lib/branches'
import { purchaseOrders } from '@/lib/db/schema'

type PurchaseOrderRecord = typeof purchaseOrders.$inferSelect
type PurchaseOrderRole = AppUser['role']

const CREATOR_ROLES: PurchaseOrderRole[] = ['admin', 'developer', 'purchase_manager']
const EA_ROLES: PurchaseOrderRole[] = ['admin', 'developer', 'ea']
const MD_ROLES: PurchaseOrderRole[] = ['admin', 'developer', 'md', 'eba']
const ACCOUNTS_ROLES: PurchaseOrderRole[] = ['admin', 'developer', 'accounts']

export const PURCHASE_ORDER_STATUSES = [
  'submitted',
  'vendor_info_pending',
  'awaiting_ea_approval',
  'ea_approved',
  'ea_denied',
  'awaiting_md_approval',
  'md_approved',
  'md_denied',
  'awaiting_grn',
  'awaiting_accounts',
  'completed',
  'cancelled',
  'on_hold',
  'ea_on_hold',
  'md_on_hold',
] as const

export const PURCHASE_ORDER_STAGES = [
  'initial_submission',
  'vendor_information',
  'ea_approval',
  'md_approval',
  'grn',
  'accounts',
] as const

export function isPurchaseOrderStatus(value: string): value is typeof PURCHASE_ORDER_STATUSES[number] {
  return (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value)
}

export function isPurchaseOrderStage(value: string): value is typeof PURCHASE_ORDER_STAGES[number] {
  return (PURCHASE_ORDER_STAGES as readonly string[]).includes(value)
}

export function canCreatePurchaseOrders(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'developer' || role === 'purchase_manager'
}

export function canViewPurchaseOrderTable(role: PurchaseOrderRole | null | undefined) {
  return role === 'purchase_manager' || role === 'ed' || role === 'accounts'
}

export function canSubmitVendorInformation(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'developer' || role === 'purchase_manager'
}

export function canApproveEa(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'developer' || role === 'ea'
}

export function canApproveMd(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'developer' || role === 'md' || role === 'eba'
}

export function canSubmitGrn(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'developer' || role === 'purchase_manager'
}

export function canProcessAccounts(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'developer' || role === 'accounts'
}

export function canManagePurchaseOrderUploads(role: PurchaseOrderRole | null | undefined, folder: string) {
  switch (folder) {
    case 'supporting-images':
    case 'vendor-images':
    case 'bill-images':
    case 'grn-images':
      return role === 'admin' || role === 'developer' || role === 'purchase_manager'
    case 'accounts-images':
      return role === 'admin' || role === 'developer' || role === 'accounts'
    default:
      return false
  }
}

export function isReadOnlyTrackingRole(role: PurchaseOrderRole | null | undefined) {
  return role === 'manager' || role === 'technician' || role === 'viewer'
}

export function getPurchaseOrderListVisibilityFilter(appUser: AppUser): SQL<unknown> {
  const baseFilters: SQL<unknown>[] = [isNull(purchaseOrders.deletedAt)]
  const branchFilter = appUser.brand && !hasAllBranchAccess(appUser.brand)
    ? or(eq(purchaseOrders.brand, appUser.brand), isNull(purchaseOrders.brand))!
    : undefined

  switch (appUser.role) {
    case 'admin':
    case 'developer':
    case 'md':
    case 'eba':
    case 'ea':
      return and(...baseFilters)!
    case 'ed':
      // ED of Kia sees all branch orders no matter which branch or department, EXCEPT Kia Jammu Service
      return and(
        ...baseFilters,
        sql`NOT (
          LOWER(COALESCE(${purchaseOrders.brand}, 'kia')) = 'kia'
          AND LOWER(COALESCE(${purchaseOrders.department}, '')) LIKE '%service%'
        )`
      )!
    case 'purchase_manager':
      return and(
        ...baseFilters,
        ...(branchFilter ? [branchFilter] : [])
      )!
    case 'accounts':
      return and(
        ...baseFilters,
        or(
          eq(purchaseOrders.assignedTo, appUser.id),
          eq(purchaseOrders.status, 'awaiting_accounts'),
          eq(purchaseOrders.status, 'completed')
        )!
      )!
    default:
      return and(
        ...baseFilters,
        or(
          eq(purchaseOrders.assignedTo, appUser.id),
          eq(purchaseOrders.createdBy, appUser.id),
          eq(purchaseOrders.requestedBy, appUser.fullName),
          eq(purchaseOrders.requestedBy, appUser.email)
        )!
      )!
  }
}

export function canReadPurchaseOrder(appUser: AppUser, order: Pick<PurchaseOrderRecord,
  'brand' | 'createdBy' | 'assignedTo' | 'requestedBy' | 'status' | 'eaApprovedBy'
> & { department?: string | null }) {
  if (appUser.role === 'admin' || appUser.role === 'developer') {
    return true
  }

  if (order.assignedTo === appUser.id) {
    return true
  }

  const branchMatches = hasAllBranchAccess(appUser.brand) || !order.brand || order.brand === appUser.brand

  switch (appUser.role) {
    case 'md':
    case 'eba':
    case 'ea':
      return true
    case 'ed': {
      // ED sees all branch orders EXCEPT Kia Jammu Service
      const isKia = !order.brand || order.brand.toLowerCase() === 'kia'
      const dept = (order.department || '').toLowerCase()
      if (isKia && dept.includes('service')) return false
      return true
    }
    case 'purchase_manager':
      return branchMatches
    case 'accounts':
      return ['awaiting_accounts', 'completed'].includes(order.status)
    default:
      return order.createdBy === appUser.id
        || order.requestedBy === appUser.fullName
        || order.requestedBy === appUser.email
  }
}

export function canMutatePurchaseOrderStage(appUser: AppUser, stage: string) {
  if (appUser.role === 'admin' || appUser.role === 'developer') {
    return true
  }

  switch (stage) {
    case 'initial_submission':
      return canCreatePurchaseOrders(appUser.role)
    case 'vendor_information':
      return canSubmitVendorInformation(appUser.role)
    case 'ea_approval':
      return canApproveEa(appUser.role)
    case 'md_approval':
      return canApproveMd(appUser.role)
    case 'grn':
      return canSubmitGrn(appUser.role)
    case 'accounts':
      return canProcessAccounts(appUser.role)
    default:
      return false
  }
}

export function getPurchaseOrderRoleLabel(role: PurchaseOrderRole | null | undefined) {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'developer':
      return 'Super Admin'
    case 'purchase_manager':
      return 'Purchase Manager'
    case 'ea':
      return 'EA'
    case 'md':
      return 'MD'
    case 'eba':
      return 'EBA'
    case 'accounts':
      return 'Accounts'
    case 'manager':
      return 'Manager'
    case 'technician':
      return 'Technician'
    case 'viewer':
      return 'Normal User'
    default:
      return 'User'
  }
}

export function getRoleQueueTitle(role: PurchaseOrderRole | null | undefined) {
  switch (role) {
    case 'purchase_manager':
      return 'My Purchase Orders'
    case 'ea':
      return 'Awaiting EA Approval'
    case 'md':
      return 'Pending MD Approval'
    case 'eba':
      return 'Pending MD Approval'
    case 'accounts':
      return 'Accounts Processing'
    case 'admin':
      return 'All Purchase Orders'
    default:
      return 'Tracked Purchase Orders'
  }
}

export const BULK_APPROVAL_ROLES = {
  ea: EA_ROLES,
  md: MD_ROLES,
} as const

export const WORKFLOW_CREATOR_ROLES = CREATOR_ROLES
export const WORKFLOW_EA_ROLES = EA_ROLES
export const WORKFLOW_MD_ROLES = MD_ROLES
export const WORKFLOW_ACCOUNTS_ROLES = ACCOUNTS_ROLES
