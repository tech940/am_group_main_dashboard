import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities, isDelegablePermission, writeAdminAudit } from '@/lib/admin/authorization'
import {
  ensurePermissionRegistrySynced,
  getPermissionCatalog,
  getRolePermissionGrants,
  isMissingPermissionTableError,
  updateRolePermissions,
} from '@/lib/permissions/service'
import { ROLE_PERMISSION_TEMPLATE_LABELS, type PermissionRole } from '@/lib/permissions/registry'

export const dynamic = 'force-dynamic'

// Roles that resolve to broad access in the resolution layer regardless of their stored
// defaults, so editing their rows has no practical effect. Surfaced to the UI as read-only.
const ABSOLUTE_ROLES = new Set<string>(['developer', 'md', 'ceo', 'ea', 'eba', 'admin'])

function isValidRole(role: string): role is PermissionRole {
  return role in ROLE_PERMISSION_TEMPLATE_LABELS
}

export async function GET() {
  try {
    const actor = await getAuthenticatedAppUser()
    const capabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !capabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await ensurePermissionRegistrySynced()
    const catalog = await getPermissionCatalog()
    const branch = capabilities.branch
    const allowedGroups = capabilities.authority === 'developer'
      ? catalog.groups
      : catalog.groups.filter((group) => Boolean(branch && (group.key === branch || group.key.startsWith(`${branch}.`))))
    const allowedGroupKeys = new Set(allowedGroups.map((group) => group.key))
    const allowedPermissions = catalog.permissions.filter((permission) =>
      typeof permission.groupKey === 'string'
      && allowedGroupKeys.has(permission.groupKey)
      && isDelegablePermission(actor, permission.key))

    const grants = await getRolePermissionGrants()

    return NextResponse.json({
      roles: (Object.keys(ROLE_PERMISSION_TEMPLATE_LABELS) as PermissionRole[]).map((key) => ({
        key,
        label: ROLE_PERMISSION_TEMPLATE_LABELS[key],
        editable: !ABSOLUTE_ROLES.has(key),
      })),
      groups: allowedGroups,
      permissions: allowedPermissions,
      grants,
      actorCapabilities: capabilities,
    })
  } catch (error) {
    if (isMissingPermissionTableError(error)) return NextResponse.json({ error: 'Permission tables are not installed.' }, { status: 503 })
    console.error('GET /api/admin/roles failed:', error)
    return NextResponse.json({ error: 'Failed to load roles.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    const capabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !capabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const role = typeof body.role === 'string' ? body.role : ''
    const requested = body.changes && typeof body.changes === 'object' ? body.changes as Record<string, boolean> : null
    if (!isValidRole(role) || !requested || Object.keys(requested).length === 0) {
      return NextResponse.json({ error: 'A valid role and changes are required.' }, { status: 400 })
    }
    if (ABSOLUTE_ROLES.has(role)) {
      return NextResponse.json({ error: 'This role always resolves to broad access and cannot be edited.' }, { status: 400 })
    }

    const invalidKeys = Object.keys(requested).filter((key) => !isDelegablePermission(actor, key))
    if (invalidKeys.length) {
      return NextResponse.json({ error: 'One or more permissions are outside your delegable scope.', invalidPermissionKeys: invalidKeys }, { status: 403 })
    }

    const changes = Object.fromEntries(Object.entries(requested).map(([key, value]) => [key, value === true]))
    const grants = await updateRolePermissions({ role, changes })
    await writeAdminAudit({
      actor,
      action: 'role_permissions.updated',
      after: { role, changes },
      request,
    })

    return NextResponse.json({ success: true, grants })
  } catch (error) {
    if (isMissingPermissionTableError(error)) return NextResponse.json({ error: 'Permission tables are not installed.' }, { status: 503 })
    console.error('PATCH /api/admin/roles failed:', error)
    return NextResponse.json({ error: 'Failed to update role.' }, { status: 500 })
  }
}
