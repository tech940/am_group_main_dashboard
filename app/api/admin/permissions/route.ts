import { NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { permissionAuditLogs, permissions, users } from '@/lib/db/schema'
import { getUserBranchLabel } from '@/lib/dashboard-config'
import {
  ensurePermissionRegistrySynced,
  getPermissionCatalog,
  getUserPermissionSnapshot,
  updateUserPermissionOverrides,
} from '@/lib/permissions/service'
import { ROLE_PERMISSION_TEMPLATE_LABELS, getTemplateMap } from '@/lib/permissions/registry'

export const dynamic = 'force-dynamic'

function isAdmin(role: string | null | undefined) {
  return role === 'admin'
}

function isMissingPermissionTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('permission_groups')
    || message.includes('user_permissions')
    || message.includes('permission_audit_logs')
    || message.includes('permissions_group_key')
}

function setupRequiredResponse() {
  return NextResponse.json({
    error: 'Permission tables are not installed yet. Run npm run db:setup-permissions-manager.',
  }, { status: 503 })
}

async function getManagedUsers() {
  const rows = await db.select({
    id: users.id,
    email: users.email,
    fullName: users.fullName,
    role: users.role,
    brand: users.brand,
    department: users.department,
    isActive: users.isActive,
    createdAt: users.createdAt,
  })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(users.fullName)

  return rows.map((user) => ({
    ...user,
    branchLabel: getUserBranchLabel(user.brand),
  }))
}

async function getAuditTrail(userId: string) {
  const rows = await db.select({
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
  })
    .from(permissionAuditLogs)
    .innerJoin(permissions, eq(permissionAuditLogs.permissionId, permissions.id))
    .leftJoin(users, eq(permissionAuditLogs.changedBy, users.id))
    .where(eq(permissionAuditLogs.targetUserId, userId))
    .orderBy(desc(permissionAuditLogs.createdAt))
    .limit(30)

  return rows
}

export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser || !isAdmin(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await ensurePermissionRegistrySynced()

    const { searchParams } = new URL(request.url)
    const selectedUserId = searchParams.get('userId')
    const [catalog, managedUsers] = await Promise.all([
      getPermissionCatalog(),
      getManagedUsers(),
    ])

    const selectedUser = selectedUserId
      ? managedUsers.find((user) => user.id === selectedUserId) || managedUsers[0] || null
      : managedUsers[0] || null

    const selectedUserSnapshot = selectedUser
      ? await getUserPermissionSnapshot(selectedUser.id)
      : { effective: {}, roleDefaults: {}, overrides: {} }

    const auditTrail = selectedUser ? await getAuditTrail(selectedUser.id) : []

    return NextResponse.json({
      users: managedUsers,
      selectedUser,
      groups: catalog.groups,
      permissions: catalog.permissions,
      snapshot: selectedUserSnapshot,
      templates: Object.fromEntries(
        Object.keys(ROLE_PERMISSION_TEMPLATE_LABELS).map((role) => [
          role,
          {
            label: ROLE_PERMISSION_TEMPLATE_LABELS[role as keyof typeof ROLE_PERMISSION_TEMPLATE_LABELS],
            permissions: getTemplateMap(role as keyof typeof ROLE_PERMISSION_TEMPLATE_LABELS),
          },
        ])
      ),
      auditTrail,
    })
  } catch (error) {
    if (isMissingPermissionTableError(error)) return setupRequiredResponse()

    console.error('Error in GET /api/admin/permissions:', error)
    return NextResponse.json({ error: 'Failed to load permissions' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser || !isAdmin(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const changes = body.permissions && typeof body.permissions === 'object'
      ? body.permissions as Record<string, boolean | null>
      : null
    const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined

    if (!userId || !changes || Object.keys(changes).length === 0) {
      return NextResponse.json({ error: 'User and permission changes are required' }, { status: 400 })
    }

    const [targetUser] = await db.select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const snapshot = await updateUserPermissionOverrides({
      targetUserId: userId,
      changedByUserId: appUser.id,
      changes,
      reason,
    })

    return NextResponse.json({
      success: true,
      snapshot,
      auditTrail: await getAuditTrail(userId),
    })
  } catch (error) {
    if (isMissingPermissionTableError(error)) return setupRequiredResponse()

    console.error('Error in PATCH /api/admin/permissions:', error)
    return NextResponse.json({ error: 'Failed to update permissions' }, { status: 500 })
  }
}
