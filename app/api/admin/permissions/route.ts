import { NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import {
  canManageAdminTarget,
  canSeeAdminTarget,
  getAdminCapabilities,
  isDelegablePermission,
  normalizePermissionChanges,
  writeAdminAudit,
} from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { permissionAuditLogs, permissions, users } from '@/lib/db/schema'
import { getUserBranchLabel } from '@/lib/dashboard-config'
import {
  ensurePermissionRegistrySynced,
  getPermissionCatalog,
  getUserPermissionSnapshot,
  isMissingPermissionTableError,
  updateUserPermissionOverrides,
} from '@/lib/permissions/service'
import { ROLE_PERMISSION_TEMPLATE_LABELS, getTemplateMap } from '@/lib/permissions/registry'

export const dynamic = 'force-dynamic'

function setupRequiredResponse() {
  return NextResponse.json({
    error: 'Permission tables are not installed. Run npm run db:setup-permissions-manager.',
  }, { status: 503 })
}

async function getVisibleUsers(actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>) {
  const capabilities = getAdminCapabilities(actor)!
  const condition = capabilities.authority === 'branch_admin'
    ? and(isNull(users.deletedAt), eq(users.brand, capabilities.branch!))
    : isNull(users.deletedAt)

  const rows = await db.select({
    id: users.id,
    email: users.email,
    fullName: users.fullName,
    role: users.role,
    brand: users.brand,
    department: users.department,
    isActive: users.isActive,
    createdAt: users.createdAt,
  }).from(users)
    .where(condition)
    .orderBy(users.fullName)

  return rows.map((user) => ({
    ...user,
    branchLabel: getUserBranchLabel(user.brand),
    canManage: canManageAdminTarget(actor, user),
    managedBySuperAdmin: canSeeAdminTarget(actor, user) && !canManageAdminTarget(actor, user),
  }))
}

async function getAuditTrail(userId: string) {
  return db.select({
    id: permissionAuditLogs.id,
    oldValue: permissionAuditLogs.oldValue,
    newValue: permissionAuditLogs.newValue,
    source: permissionAuditLogs.source,
    reason: permissionAuditLogs.reason,
    createdAt: permissionAuditLogs.createdAt,
    permissionKey: permissions.name,
    permissionLabel: permissions.label,
    changedByName: users.fullName,
    changedByEmail: users.email,
  }).from(permissionAuditLogs)
    .innerJoin(permissions, eq(permissionAuditLogs.permissionId, permissions.id))
    .leftJoin(users, eq(permissionAuditLogs.changedBy, users.id))
    .where(eq(permissionAuditLogs.targetUserId, userId))
    .orderBy(desc(permissionAuditLogs.createdAt))
    .limit(50)
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    const actorCapabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !actorCapabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await ensurePermissionRegistrySynced()
    const { searchParams } = new URL(request.url)
    const selectedUserId = searchParams.get('userId')
    const [catalog, visibleUsers] = await Promise.all([getPermissionCatalog(), getVisibleUsers(actor)])
    const selectedUser = selectedUserId
      ? visibleUsers.find((user) => user.id === selectedUserId) || visibleUsers[0] || null
      : visibleUsers[0] || null

    const branch = actorCapabilities.branch
    const allowedGroups = actorCapabilities.authority === 'developer'
      ? catalog.groups
      : catalog.groups.filter((group) =>
        Boolean(branch && (group.key === branch || group.key.startsWith(`${branch}.`)))
      )
    const allowedGroupKeys = new Set(allowedGroups.map((group) => group.key))
    const allowedPermissions = catalog.permissions.filter((permission) =>
      typeof permission.groupKey === 'string'
      && allowedGroupKeys.has(permission.groupKey)
      && isDelegablePermission(actor, permission.key)
    )
    const snapshot = selectedUser
      ? await getUserPermissionSnapshot(selectedUser.id)
      : { effective: {}, roleDefaults: {}, overrides: {} }

    return NextResponse.json({
      users: visibleUsers,
      selectedUser,
      groups: allowedGroups,
      permissions: allowedPermissions,
      snapshot,
      actorCapabilities,
      templates: Object.fromEntries(
        Object.keys(ROLE_PERMISSION_TEMPLATE_LABELS).map((role) => {
          const template = getTemplateMap(role as keyof typeof ROLE_PERMISSION_TEMPLATE_LABELS)
          return [role, {
            label: ROLE_PERMISSION_TEMPLATE_LABELS[role as keyof typeof ROLE_PERMISSION_TEMPLATE_LABELS],
            permissions: Object.fromEntries(
              Object.entries(template).filter(([key]) =>
                actorCapabilities.authority === 'developer' || isDelegablePermission(actor, key)
              )
            ),
          }]
        })
      ),
      auditTrail: selectedUser ? await getAuditTrail(selectedUser.id) : [],
    })
  } catch (error) {
    if (isMissingPermissionTableError(error)) return setupRequiredResponse()
    console.error('GET /api/admin/permissions failed:', error)
    return NextResponse.json({ error: 'Failed to load permissions.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    if (!actor || !getAdminCapabilities(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const requested = body.permissions && typeof body.permissions === 'object'
      ? body.permissions as Record<string, boolean | null>
      : null
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined
    if (!userId || !requested || Object.keys(requested).length === 0) {
      return NextResponse.json({ error: 'User and permission changes are required.' }, { status: 400 })
    }

    const [target] = await db.select({
      id: users.id,
      role: users.role,
      brand: users.brand,
      isActive: users.isActive,
    }).from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    if (!canManageAdminTarget(actor, target)) {
      return NextResponse.json({ error: 'This user is managed by Developer.' }, { status: 403 })
    }

    const invalidKeys = Object.keys(requested).filter((key) => !isDelegablePermission(actor, key))
    if (invalidKeys.length) {
      return NextResponse.json({
        error: 'One or more permissions are outside your delegable branch namespace.',
        invalidPermissionKeys: invalidKeys,
      }, { status: 403 })
    }

    const changes = normalizePermissionChanges(actor, requested)
    const before = await getUserPermissionSnapshot(userId)
    const snapshot = await updateUserPermissionOverrides({
      targetUserId: userId,
      changedByUserId: actor.id,
      changes,
      reason,
    })
    // (Removed a dead invalidateCachePattern('access-matrix:*') here: the access-matrix route is
    // explicitly uncached — the pattern matched no keys and only cost a full-keyspace Redis SCAN per edit.)
    await writeAdminAudit({
      actor,
      action: 'permissions.updated',
      targetUserId: userId,
      branch: target.brand,
      before: { effective: before.effective },
      after: { effective: snapshot.effective, requested, normalized: changes },
      reason,
      request,
    })

    return NextResponse.json({
      success: true,
      snapshot,
      normalizedChanges: changes,
      auditTrail: await getAuditTrail(userId),
    })
  } catch (error) {
    if (isMissingPermissionTableError(error)) return setupRequiredResponse()
    console.error('PATCH /api/admin/permissions failed:', error)
    return NextResponse.json({ error: 'Failed to update permissions.' }, { status: 500 })
  }
}
