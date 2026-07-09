import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminAuditLogs, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import {
  isAdminRole,
  isBranchAdminRole,
  isSuperAdminRole,
} from '@/lib/auth/roles'
import { isBranchValue } from '@/lib/branches'
import { PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permissions/registry'

export const PROTECTED_ROLES = new Set<AppUser['role']>([
  'developer',
  'admin',
  'branch_admin',
  'md',
  'eba',
  'ceo',
  'ea',
  'accounts',
  'purchase_manager',
  'finance_head',
])
export const BRANCH_ASSIGNABLE_ROLES = new Set<AppUser['role']>([
  'manager',
  'technician',
  'viewer',
  'service_manager',
  'general_manager',
  'service_general_manager',
  'sales_head'
])

export type AdminActorCapabilities = {
  authority: 'developer' | 'branch_admin'
  branch: string | null
  canManageAllBranches: boolean
  canManageProtectedRoles: boolean
  canManageBranchAdmins: boolean
  canManageSettings: boolean
  canPermanentlyDelete: boolean
  assignableRoles: AppUser['role'][]
  delegablePermissionPrefixes: string[]
}

export type AdminTarget = {
  id: string
  role: AppUser['role']
  brand: string | null
  isActive?: boolean
}

export { isAdminRole, isBranchAdminRole, isSuperAdminRole }

export function getAdminCapabilities(actor: AppUser): AdminActorCapabilities | null {
  if (isSuperAdminRole(actor.role)) {
    return {
      authority: 'developer',
      branch: null,
      canManageAllBranches: true,
      canManageProtectedRoles: true,
      canManageBranchAdmins: true,
      canManageSettings: true,
      canPermanentlyDelete: true,
      assignableRoles: users.role.enumValues.filter((role) => role !== 'admin'),
      delegablePermissionPrefixes: ['*'],
    }
  }

  return null
}

export function canSeeAdminTarget(actor: AppUser, target: AdminTarget) {
  const capabilities = getAdminCapabilities(actor)
  if (!capabilities) return false
  if (capabilities.authority === 'developer') return true
  return target.brand === capabilities.branch
}

export function canManageAdminTarget(actor: AppUser, target: AdminTarget) {
  const capabilities = getAdminCapabilities(actor)
  if (!capabilities || actor.id === target.id) return false
  if (capabilities.authority === 'developer') return true
  return target.brand === capabilities.branch && !PROTECTED_ROLES.has(target.role)
}

export function canAssignRole(actor: AppUser, role: AppUser['role']) {
  const capabilities = getAdminCapabilities(actor)
  return Boolean(capabilities?.assignableRoles.includes(role) && role !== 'admin')
}

export function resolveManagedBranch(actor: AppUser, requestedBranch: string | null) {
  const capabilities = getAdminCapabilities(actor)
  if (!capabilities) return undefined
  if (capabilities.authority === 'branch_admin') return capabilities.branch
  if (!requestedBranch || requestedBranch === 'all' || isBranchValue(requestedBranch)) return requestedBranch
  
  if (requestedBranch.includes(',')) {
    const branches = requestedBranch.split(',').map((b) => b.trim())
    if (branches.every(isBranchValue)) return requestedBranch
  }
  
  return undefined
}

export function isDelegablePermission(actor: AppUser, permissionKey: string) {
  const capabilities = getAdminCapabilities(actor)
  if (!capabilities) return false
  if (capabilities.authority === 'developer') return true
  return permissionKey.startsWith(`${capabilities.branch}.`)
}

function descendantGroupKeys(groupKey: string) {
  const descendants = new Set([groupKey])
  let changed = true
  while (changed) {
    changed = false
    for (const group of PERMISSION_GROUPS) {
      if (group.parentKey && descendants.has(group.parentKey) && !descendants.has(group.key)) {
        descendants.add(group.key)
        changed = true
      }
    }
  }
  return descendants
}

function ancestorGroupKeys(groupKey: string) {
  const byKey = new Map(PERMISSION_GROUPS.map((group) => [group.key, group]))
  const ancestors: string[] = []
  let current = byKey.get(groupKey)
  while (current?.parentKey) {
    ancestors.push(current.parentKey)
    current = byKey.get(current.parentKey)
  }
  return ancestors
}

export function normalizePermissionChanges(
  actor: AppUser,
  requested: Record<string, boolean | null>
) {
  const permitted = Object.fromEntries(
    Object.entries(requested).filter(([key]) => isDelegablePermission(actor, key))
  ) as Record<string, boolean | null>
  const permissionByKey = new Map(PERMISSIONS.map((permission) => [permission.key, permission]))
  const keysByGroup = new Map<string, typeof PERMISSIONS>()
  for (const permission of PERMISSIONS) {
    const existing = keysByGroup.get(permission.groupKey) || []
    existing.push(permission)
    keysByGroup.set(permission.groupKey, existing)
  }

  for (const [key, value] of Object.entries({ ...permitted })) {
    const permission = permissionByKey.get(key)
    if (!permission) continue

    if (value === true) {
      if (permission.action !== 'view') {
        const viewPermission = (keysByGroup.get(permission.groupKey) || []).find((item) => item.action === 'view')
        if (viewPermission && isDelegablePermission(actor, viewPermission.key)) permitted[viewPermission.key] = true
      }
      for (const ancestor of ancestorGroupKeys(permission.groupKey)) {
        const viewPermission = (keysByGroup.get(ancestor) || []).find((item) => item.action === 'view')
        if (viewPermission && isDelegablePermission(actor, viewPermission.key)) permitted[viewPermission.key] = true
      }
    }

    if (value === false && permission.action === 'view') {
      for (const descendant of descendantGroupKeys(permission.groupKey)) {
        for (const childPermission of keysByGroup.get(descendant) || []) {
          if (isDelegablePermission(actor, childPermission.key)) permitted[childPermission.key] = false
        }
      }
    }
  }

  return permitted
}

export async function getAdminTarget(userId: string) {
  const [target] = await db.select({
    id: users.id,
    role: users.role,
    brand: users.brand,
    isActive: users.isActive,
  }).from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)
  return target || null
}

export async function writeAdminAudit(params: {
  actor: AppUser
  action: string
  targetUserId?: string | null
  branch?: string | null
  before?: unknown
  after?: unknown
  reason?: string | null
  request?: Request
}) {
  const forwardedFor = params.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  await db.insert(adminAuditLogs).values({
    actorUserId: params.actor.id,
    targetUserId: params.targetUserId || null,
    action: params.action,
    branch: params.branch || null,
    beforeValue: params.before ?? null,
    afterValue: params.after ?? null,
    reason: params.reason || null,
    requestMetadata: params.request ? {
      ip: forwardedFor,
      userAgent: params.request.headers.get('user-agent'),
      method: params.request.method,
      url: params.request.url,
    } : null,
  })
}
