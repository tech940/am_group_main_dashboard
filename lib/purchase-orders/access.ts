import { and, eq, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess } from '@/lib/branches'
import { purchaseOrders } from '@/lib/db/schema'

type PurchaseOrderRecord = typeof purchaseOrders.$inferSelect
type PurchaseOrderRole = AppUser['role']

const CREATOR_ROLES: PurchaseOrderRole[] = ['admin', 'purchase_manager']
const EA_ROLES: PurchaseOrderRole[] = ['admin', 'ea']
const MD_ROLES: PurchaseOrderRole[] = ['admin', 'md']
const ACCOUNTS_ROLES: PurchaseOrderRole[] = ['admin', 'accounts']

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
  return role === 'admin' || role === 'purchase_manager'
}

export function canSubmitVendorInformation(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'purchase_manager'
}

export function canApproveEa(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'ea'
}

export function canApproveMd(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'md'
}

export function canSubmitGrn(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'purchase_manager'
}

export function canProcessAccounts(role: PurchaseOrderRole | null | undefined) {
  return role === 'admin' || role === 'accounts'
}

export function canManagePurchaseOrderUploads(role: PurchaseOrderRole | null | undefined, folder: string) {
  switch (folder) {
    case 'supporting-images':
    case 'vendor-images':
    case 'bill-images':
    case 'grn-images':
      return role === 'admin' || role === 'purchase_manager'
    case 'accounts-images':
      return role === 'admin' || role === 'accounts'
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
    case 'purchase_manager':
      return and(...baseFilters)!
    case 'md':
      return and(
        ...baseFilters,
        ...(branchFilter ? [branchFilter] : [])
      )!
    case 'ea':
      return and(
        ...baseFilters,
        ...(branchFilter ? [branchFilter] : []),
        or(
          eq(purchaseOrders.assignedTo, appUser.id),
          eq(purchaseOrders.status, 'awaiting_ea_approval'),
          eq(purchaseOrders.status, 'awaiting_md_approval'),
          eq(purchaseOrders.status, 'awaiting_grn'),
          eq(purchaseOrders.status, 'awaiting_accounts'),
          eq(purchaseOrders.status, 'completed'),
          eq(purchaseOrders.status, 'ea_denied'),
          eq(purchaseOrders.status, 'md_denied'),
          eq(purchaseOrders.status, 'ea_on_hold'),
          eq(purchaseOrders.status, 'md_on_hold'),
          eq(purchaseOrders.eaApprovedBy, appUser.id)
        )!
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
>) {
  if (appUser.role === 'admin' || appUser.role === 'purchase_manager') {
    return true
  }

  if (order.assignedTo === appUser.id) {
    return true
  }

  const branchMatches = hasAllBranchAccess(appUser.brand) || !order.brand || order.brand === appUser.brand

  switch (appUser.role) {
    case 'md':
      return branchMatches
    case 'ea':
      return branchMatches && ([
        'awaiting_ea_approval',
        'awaiting_md_approval',
        'awaiting_grn',
        'awaiting_accounts',
        'completed',
        'ea_denied',
        'md_denied',
        'ea_on_hold',
        'md_on_hold',
      ].includes(order.status) || order.eaApprovedBy === appUser.id)
    case 'accounts':
      return ['awaiting_accounts', 'completed'].includes(order.status)
    default:
      return order.createdBy === appUser.id
        || order.requestedBy === appUser.fullName
        || order.requestedBy === appUser.email
  }
}

export function canMutatePurchaseOrderStage(appUser: AppUser, stage: string) {
  if (appUser.role === 'admin') {
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
    case 'purchase_manager':
      return 'Purchase Manager'
    case 'ea':
      return 'EA'
    case 'md':
      return 'MD'
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
