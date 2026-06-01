import 'server-only'

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permissionAuditLogs, permissionGroups, permissions, rolePermissions, userPermissions, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
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

const PERMISSION_CACHE_VERSION = 'v1'
const PERMISSION_CACHE_TTL_SECONDS = 75 * 60

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

function buildRoleTemplateSnapshot(role: PermissionRole): PermissionSnapshot {
  const roleKeys = new Set(role === 'admin' ? PERMISSIONS.map((permission) => permission.key) : (ROLE_PERMISSION_TEMPLATES[role] || []))
  const roleDefaults = Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, roleKeys.has(permission.key)]))
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
  const [targetUser] = await db.select({ id: users.id, role: users.role })
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
      return buildRoleTemplateSnapshot(targetUser.role)
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

  const overrides: Record<string, boolean> = {}
  for (const row of overrideRows) {
    const key = keyById.get(row.permissionId)
    if (key) overrides[key] = row.allowed
  }

  const effective = { ...roleDefaults, ...overrides }
  if (targetUser.role === 'admin') {
    for (const key of Object.keys(effective)) effective[key] = true
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
  if (appUser.role === 'admin') return true

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
  await ensurePermissionRegistrySynced()

  const permissionRows = await db.select({ id: permissions.id, key: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, Object.keys(params.changes)))

  const permissionByKey = new Map(permissionRows.map((permission) => [permission.key, permission]))
  const before = await buildUserPermissionSnapshot(params.targetUserId)
  const now = new Date()
  const auditRows: Array<typeof permissionAuditLogs.$inferInsert> = []

  for (const [permissionKey, value] of Object.entries(params.changes)) {
    const permission = permissionByKey.get(permissionKey)
    if (!permission) continue

    const newEffectiveValue = value === null
      ? before.roleDefaults[permissionKey] === true
      : value

    if (value === null) {
      await db.delete(userPermissions)
        .where(and(
          eq(userPermissions.userId, params.targetUserId),
          eq(userPermissions.permissionId, permission.id)
        ))
    } else {
      await db.insert(userPermissions)
        .values({
          userId: params.targetUserId,
          permissionId: permission.id,
          allowed: value,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userPermissions.userId, userPermissions.permissionId],
          set: {
            allowed: value,
            updatedAt: now,
          },
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

  if (auditRows.length > 0) {
    await db.insert(permissionAuditLogs).values(auditRows)
  }

  await clearUserPermissionCache(params.targetUserId)
  return buildUserPermissionSnapshot(params.targetUserId)
}
