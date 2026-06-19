import 'server-only'

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permissionAuditLogs, permissionGroups, permissions, rolePermissions, userPermissions, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { getCachedData, invalidateCache } from '@/lib/redis/cache-utils'
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_PERMISSION_TEMPLATES,
  type PermissionRole,
} from '@/lib/permissions/registry'

export type PermissionSnapshot = {
  effective: Record<string, boolean>
  roleDefaults: Record<string, boolean>
  overrides: Record<string, boolean>
}

export type PermissionDeniedResult = {
  allowed: false
  reason: string
}

export type PermissionAllowedResult = {
  allowed: true
}

export type PermissionCheckResult = PermissionAllowedResult | PermissionDeniedResult

const PERMISSION_CACHE_VERSION = 'v5'
const PERMISSION_CACHE_TTL_SECONDS = 75 * 60
const ADMIN_ONLY_PERMISSION_GROUPS = new Set(['user_management', 'access_control', 'admin_audit'])

function isAdminOnlyPermission(permissionKey: string) {
  const permission = PERMISSIONS.find((item) => item.key === permissionKey)
  return Boolean(permission && ADMIN_ONLY_PERMISSION_GROUPS.has(permission.groupKey))
}

export function isMissingPermissionTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('permission_groups')
    || message.includes('permissions')
    || message.includes('role_permissions')
    || message.includes('user_permissions')
    || message.includes('permission_audit_logs')
    || message.includes('relation "permission_')
    || message.includes("relation 'permission_")
}

const BRANCH_PERMISSION_PREFIXES = BRANCH_OPTIONS.map((branch) => branch.value)

function getBranchPermissionPrefixes(branchAccess: string | null | undefined) {
  if (hasAllBranchAccess(branchAccess)) return BRANCH_PERMISSION_PREFIXES
  return BRANCH_PERMISSION_PREFIXES.includes(branchAccess as typeof BRANCH_PERMISSION_PREFIXES[number])
    ? [branchAccess as typeof BRANCH_PERMISSION_PREFIXES[number]]
    : []
}

function applyBranchRoleDefaults(
  roleDefaults: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined
) {
  const prefixes = getBranchPermissionPrefixes(branchAccess)
  if (prefixes.length === 0) return
  const availableKeys = new Set(PERMISSIONS.map((permission) => permission.key))

  if (role === 'manager' || role === 'technician' || role === 'viewer') {
    const kiaTemplateKeys = ROLE_PERMISSION_TEMPLATES[role].filter((key) =>
      key === 'kia.view' || key.startsWith('kia.')
    )
    for (const prefix of prefixes) {
      for (const key of kiaTemplateKeys) {
        const mappedKey = `${prefix}${key.slice('kia'.length)}`
        if (availableKeys.has(mappedKey)) roleDefaults[mappedKey] = true
      }
    }
  }

  for (const permission of PERMISSIONS) {
    const isInBranch = prefixes.some((prefix) =>
      permission.groupKey === prefix || permission.groupKey.startsWith(`${prefix}.`)
    )
    if (!isInBranch) continue

    if (role === 'branch_admin') {
      roleDefaults[permission.key] = true
    }
  }
}

function constrainSnapshotToBranch(
  values: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined
) {
  if (isSuperAdminRole(role) || hasGlobalAccessRole(role) || hasAllBranchAccess(branchAccess)) return
  const prefixes = getBranchPermissionPrefixes(branchAccess)

  for (const permission of PERMISSIONS) {
    const belongsToKnownBranch = BRANCH_PERMISSION_PREFIXES.some((prefix) =>
      permission.groupKey === prefix || permission.groupKey.startsWith(`${prefix}.`)
    )
    if (!belongsToKnownBranch) continue
    const isAssignedBranch = prefixes.some((prefix) =>
      permission.groupKey === prefix || permission.groupKey.startsWith(`${prefix}.`)
    )
    if (!isAssignedBranch) values[permission.key] = false
  }
}

function buildRoleTemplateSnapshot(role: PermissionRole, branchAccess?: string | null): PermissionSnapshot {
  const roleKeys = new Set(
    isSuperAdminRole(role)
      ? PERMISSIONS.map((permission) => permission.key)
      : hasGlobalAccessRole(role)
        ? PERMISSIONS.filter((permission) => !ADMIN_ONLY_PERMISSION_GROUPS.has(permission.groupKey)).map((permission) => permission.key)
      : (ROLE_PERMISSION_TEMPLATES[role] || [])
  )
  const roleDefaults = Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, roleKeys.has(permission.key)]))
  applyBranchRoleDefaults(roleDefaults, role, branchAccess)
  constrainSnapshotToBranch(roleDefaults, role, branchAccess)
  if (isSuperAdminRole(role)) {
    for (const key of Object.keys(roleDefaults)) roleDefaults[key] = true
  } else if (hasGlobalAccessRole(role)) {
    for (const key of Object.keys(roleDefaults)) roleDefaults[key] = !isAdminOnlyPermission(key)
  } else if (branchAccess) {
    for (const key of Object.keys(roleDefaults)) {
      if (key.startsWith(`${branchAccess}.`)) {
        roleDefaults[key] = true
      }
    }
  }

  return {
    effective: { ...roleDefaults },
    roleDefaults,
    overrides: {},
  }
}

export function getPermissionCacheKey(userId: string) {
  return `permissions:${PERMISSION_CACHE_VERSION}:user:${userId}`
}

export async function clearUserPermissionCache(userId: string) {
  await invalidateCache(getPermissionCacheKey(userId))
}

export async function ensurePermissionRegistrySynced() {
  const now = new Date()

  if (PERMISSION_GROUPS.length > 0) {
    await db.insert(permissionGroups)
      .values(PERMISSION_GROUPS.map((group) => ({
        key: group.key,
        name: group.name,
        parentKey: group.parentKey,
        description: group.description,
        sortOrder: group.sortOrder,
        isActive: true,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: permissionGroups.key,
        set: {
          name: sql`excluded.name`,
          parentKey: sql`excluded.parent_key`,
          description: sql`excluded.description`,
          sortOrder: sql`excluded.sort_order`,
          isActive: true,
          updatedAt: now,
        },
      })
  }

  if (PERMISSIONS.length > 0) {
    await db.insert(permissions)
      .values(PERMISSIONS.map((permission) => ({
        name: permission.key,
        groupKey: permission.groupKey,
        label: permission.label,
        description: permission.description,
        resource: permission.resource,
        action: permission.action,
        sortOrder: permission.sortOrder,
        isActive: true,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: permissions.name,
        set: {
          groupKey: sql`excluded.group_key`,
          label: sql`excluded.label`,
          description: sql`excluded.description`,
          resource: sql`excluded.resource`,
          action: sql`excluded.action`,
          sortOrder: sql`excluded.sort_order`,
          isActive: true,
          updatedAt: now,
        },
      })
  }

  const permissionRows = await db.select({ id: permissions.id, name: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, PERMISSIONS.map((permission) => permission.key)))

  const permissionIdByName = new Map(permissionRows.map((permission) => [permission.name, permission.id]))

  const rolePermissionRows = Object.entries(ROLE_PERMISSION_TEMPLATES)
    .flatMap(([role, permissionKeys]) => permissionKeys
      .map((permissionKey) => {
        const permissionId = permissionIdByName.get(permissionKey)
        return permissionId
          ? { role: role as PermissionRole, permissionId, allowed: true, updatedAt: now }
          : null
      })
      .filter((value): value is { role: PermissionRole; permissionId: string; allowed: boolean; updatedAt: Date } => Boolean(value)))

  if (rolePermissionRows.length > 0) {
    await db.insert(rolePermissions)
      .values(rolePermissionRows)
      .onConflictDoUpdate({
        target: [rolePermissions.role, rolePermissions.permissionId],
        set: {
          allowed: true,
          updatedAt: now,
        },
      })
  }
}

export async function getPermissionCatalog() {
  try {
    await ensurePermissionRegistrySynced()
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return {
        groups: PERMISSION_GROUPS.map((group) => ({
          id: group.key,
          key: group.key,
          name: group.name,
          parentKey: group.parentKey,
          description: group.description,
          sortOrder: group.sortOrder,
          isActive: true,
        })),
        permissions: PERMISSIONS.map((permission) => ({
          id: permission.key,
          key: permission.key,
          groupKey: permission.groupKey,
          label: permission.label,
          description: permission.description,
          resource: permission.resource,
          action: permission.action,
          sortOrder: permission.sortOrder,
          isActive: true,
        })),
        setupRequired: true,
      }
    }
    throw error
  }

  const [groupRows, permissionRows] = await Promise.all([
    db.select({
      id: permissionGroups.id,
      key: permissionGroups.key,
      name: permissionGroups.name,
      parentKey: permissionGroups.parentKey,
      description: permissionGroups.description,
      sortOrder: permissionGroups.sortOrder,
      isActive: permissionGroups.isActive,
    })
      .from(permissionGroups)
      .where(eq(permissionGroups.isActive, true))
      .orderBy(permissionGroups.sortOrder, permissionGroups.name),
    db.select({
      id: permissions.id,
      key: permissions.name,
      groupKey: permissions.groupKey,
      label: permissions.label,
      description: permissions.description,
      resource: permissions.resource,
      action: permissions.action,
      sortOrder: permissions.sortOrder,
      isActive: permissions.isActive,
    })
      .from(permissions)
      .where(eq(permissions.isActive, true))
      .orderBy(permissions.sortOrder, permissions.name),
  ])

  return { groups: groupRows, permissions: permissionRows }
}

async function buildUserPermissionSnapshot(userId: string): Promise<PermissionSnapshot> {
  const [targetUser] = await db.select({ id: users.id, role: users.role, brand: users.brand })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)

  if (!targetUser) {
    return { effective: {}, roleDefaults: {}, overrides: {} }
  }

  try {
    await ensurePermissionRegistrySynced()
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return buildRoleTemplateSnapshot(targetUser.role, targetUser.brand)
    }
    throw error
  }

  const permissionRows = await db.select({ id: permissions.id, key: permissions.name })
    .from(permissions)
    .where(eq(permissions.isActive, true))

  const roleRows = await db.select({
    permissionId: rolePermissions.permissionId,
    allowed: rolePermissions.allowed,
  })
    .from(rolePermissions)
    .where(eq(rolePermissions.role, targetUser.role))

  const overrideRows = await db.select({
    permissionId: userPermissions.permissionId,
    allowed: userPermissions.allowed,
  })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))

  const keyById = new Map(permissionRows.map((permission) => [permission.id, permission.key]))
  const roleDefaults = Object.fromEntries(permissionRows.map((permission) => [permission.key, false]))

  for (const row of roleRows) {
    const key = keyById.get(row.permissionId)
    if (key) roleDefaults[key] = row.allowed
  }

  applyBranchRoleDefaults(roleDefaults, targetUser.role, targetUser.brand)
  constrainSnapshotToBranch(roleDefaults, targetUser.role, targetUser.brand)

  const overrides: Record<string, boolean> = {}
  for (const row of overrideRows) {
    const key = keyById.get(row.permissionId)
    if (key) overrides[key] = row.allowed
  }

  const effective = { ...roleDefaults, ...overrides }
  constrainSnapshotToBranch(effective, targetUser.role, targetUser.brand)
  if (isSuperAdminRole(targetUser.role)) {
    for (const key of Object.keys(effective)) effective[key] = true
  } else if (hasGlobalAccessRole(targetUser.role)) {
    for (const key of Object.keys(effective)) effective[key] = !isAdminOnlyPermission(key)
  } else if (targetUser.brand) {
    for (const key of Object.keys(effective)) {
      if (key.startsWith(`${targetUser.brand}.`)) {
        effective[key] = true
      }
    }
  }

  return { effective, roleDefaults, overrides }
}

export async function getUserPermissionSnapshot(userId: string) {
  return getCachedData(
    getPermissionCacheKey(userId),
    () => buildUserPermissionSnapshot(userId),
    PERMISSION_CACHE_TTL_SECONDS
  )
}

export async function canUserAccessPermission(appUser: AppUser | null, permissionKey: string): Promise<boolean> {
  if (!appUser || !appUser.isActive) return false
  if (isSuperAdminRole(appUser.role)) return true
  if (hasGlobalAccessRole(appUser.role)) return !isAdminOnlyPermission(permissionKey)

  if (appUser.brand && permissionKey.startsWith(`${appUser.brand}.`)) return true

  const snapshot = await getUserPermissionSnapshot(appUser.id)
  return snapshot.effective[permissionKey] === true
}

export async function requirePermission(appUser: AppUser | null, permissionKey: string): Promise<PermissionCheckResult> {
  const allowed = await canUserAccessPermission(appUser, permissionKey)
  if (allowed) return { allowed: true }

  return {
    allowed: false,
    reason: 'You do not have access to this section. Please contact your administrator.',
  }
}

export async function updateUserPermissionOverrides(params: {
  targetUserId: string
  changedByUserId: string
  changes: Record<string, boolean | null>
  reason?: string
}) {
  const changeEntries = Object.entries(params.changes)
  if (changeEntries.length === 0) {
    return buildUserPermissionSnapshot(params.targetUserId)
  }

  await ensurePermissionRegistrySynced()

  const permissionRows = await db.select({ id: permissions.id, key: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, changeEntries.map(([permissionKey]) => permissionKey)))

  const permissionByKey = new Map(permissionRows.map((permission) => [permission.key, permission]))
  const before = await buildUserPermissionSnapshot(params.targetUserId)
  const now = new Date()
  const auditRows: Array<typeof permissionAuditLogs.$inferInsert> = []
  const deletePermissionIds: string[] = []
  const upsertRows: Array<typeof userPermissions.$inferInsert> = []

  for (const [permissionKey, value] of changeEntries) {
    const permission = permissionByKey.get(permissionKey)
    if (!permission) continue

    const newEffectiveValue = value === null
      ? before.roleDefaults[permissionKey] === true
      : value

    if (value === null) {
      deletePermissionIds.push(permission.id)
    } else {
      upsertRows.push({
        userId: params.targetUserId,
        permissionId: permission.id,
        allowed: value,
        updatedAt: now,
      })
    }

    if (before.effective[permissionKey] !== newEffectiveValue) {
      auditRows.push({
        targetUserId: params.targetUserId,
        permissionId: permission.id,
        changedBy: params.changedByUserId,
        oldValue: before.effective[permissionKey] === true,
        newValue: newEffectiveValue,
        source: 'manual',
        reason: params.reason || null,
      })
    }
  }

  await Promise.all([
    deletePermissionIds.length > 0
      ? db.delete(userPermissions)
        .where(and(
          eq(userPermissions.userId, params.targetUserId),
          inArray(userPermissions.permissionId, deletePermissionIds)
        ))
      : Promise.resolve(),
    upsertRows.length > 0
      ? db.insert(userPermissions)
        .values(upsertRows)
        .onConflictDoUpdate({
          target: [userPermissions.userId, userPermissions.permissionId],
          set: {
            allowed: sql`excluded.allowed`,
            updatedAt: now,
          },
        })
      : Promise.resolve(),
    auditRows.length > 0
      ? db.insert(permissionAuditLogs).values(auditRows)
      : Promise.resolve(),
  ])

  await clearUserPermissionCache(params.targetUserId)
  return buildUserPermissionSnapshot(params.targetUserId)
}
