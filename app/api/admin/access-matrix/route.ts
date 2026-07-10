import { NextResponse } from 'next/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canManageAdminTarget, getAdminCapabilities, isDelegablePermission } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { permissions, rolePermissions, userPermissions, users } from '@/lib/db/schema'
import { getUserBranchLabel } from '@/lib/dashboard-config'
import {
  getPermissionCatalog,
  isMissingPermissionTableError,
  resolveEffectiveSnapshot,
} from '@/lib/permissions/service'
import { SECTION_ROUTES, type PermissionRole } from '@/lib/permissions/registry'

export const dynamic = 'force-dynamic'

// "Who can access which sections" — the effective view access for every user the actor may
// see. Computed in BULK: instead of building each user's snapshot one-by-one (which re-syncs
// the registry per user), we read role_permissions + user_permissions once and resolve every
// user in memory. NOT cached: the grid is editable (tick to grant / untick to deny) and edits
// must reflect immediately on reload — the bulk read is only three fast queries. Note it reads
// user_permissions straight from the DB, so it always reflects the latest saved overrides.
export async function GET() {
  try {
    const actor = await getAuthenticatedAppUser()
    const capabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !capabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const payload = await buildMatrix(actor, capabilities)
    // canManage depends on the specific actor (e.g. can't manage self), so resolve it per-request.
    const usersWithManage = payload.users.map((user) => ({
      ...user,
      canManage: canManageAdminTarget(actor, { id: user.id, role: user.role, brand: user.brand, isActive: user.isActive }),
    }))
    return NextResponse.json({ ...payload, users: usersWithManage, actorCapabilities: capabilities })
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return NextResponse.json({ error: 'Permission tables are not installed.' }, { status: 503 })
    }
    console.error('GET /api/admin/access-matrix failed:', error)
    return NextResponse.json({ error: 'Failed to load the access map.' }, { status: 500 })
  }
}

async function buildMatrix(
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>,
  capabilities: NonNullable<ReturnType<typeof getAdminCapabilities>>,
) {
    // getPermissionCatalog runs the registry sync once for the whole request.
    const catalog = await getPermissionCatalog()

    const routeKeys = new Set(Object.keys(SECTION_ROUTES))
    // Kept in the payload (never shown as a column) so the single "Admin Panel" toggle's save
    // fan-out can read their defaultVisible — the UI hides them (features/admin/access-map.tsx).
    const ADMIN_FANOUT_KEYS = new Set(['access_control', 'admin_audit', 'dashboard_settings'])
    const branch = capabilities.branch
    const sections = catalog.groups
      // The Access Map controls only TOP-LEVEL navigable pages — exactly one toggle per sidebar
      // route (SECTION_ROUTES). Sub-sections (BE sub-reports, booking sub-stages, stock management,
      // empty brands, internal grouping nodes, …) are NOT toggleable here — they're handled in code.
      .filter((group) => routeKeys.has(group.key) || ADMIN_FANOUT_KEYS.has(group.key))
      .filter((group) => capabilities.authority === 'developer'
        || Boolean(branch && (group.key === branch || group.key.startsWith(`${branch}.`))))
      .filter((group) => isDelegablePermission(actor, `${group.key}.view`))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))

    const condition = capabilities.authority === 'branch_admin' && capabilities.branch
      ? and(isNull(users.deletedAt), eq(users.brand, capabilities.branch))
      : isNull(users.deletedAt)

    const userRows = await db.select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      brand: users.brand,
      isActive: users.isActive,
    }).from(users).where(condition).orderBy(users.fullName)

    const userIds = userRows.map((user) => user.id)

    // Three flat reads instead of one snapshot build per user.
    const [permRows, roleRows, overrideRows] = await Promise.all([
      db.select({ id: permissions.id, key: permissions.name }).from(permissions).where(eq(permissions.isActive, true)),
      db.select({ role: rolePermissions.role, permissionId: rolePermissions.permissionId, allowed: rolePermissions.allowed }).from(rolePermissions),
      userIds.length
        ? db.select({ userId: userPermissions.userId, permissionId: userPermissions.permissionId, allowed: userPermissions.allowed })
          .from(userPermissions).where(inArray(userPermissions.userId, userIds))
        : Promise.resolve([] as { userId: string; permissionId: string; allowed: boolean }[]),
    ])

    const keyById = new Map(permRows.map((row) => [row.id, row.key]))
    const allFalse = Object.fromEntries(permRows.map((row) => [row.key, false])) as Record<string, boolean>

    // role -> { permissionKey: allowed }
    const roleDefaultsByRole = new Map<string, Record<string, boolean>>()
    for (const row of roleRows) {
      const key = keyById.get(row.permissionId)
      if (!key) continue
      const map = roleDefaultsByRole.get(row.role) || {}
      map[key] = row.allowed
      roleDefaultsByRole.set(row.role, map)
    }

    // userId -> { permissionKey: allowed }
    const overridesByUser = new Map<string, Record<string, boolean>>()
    for (const row of overrideRows) {
      const key = keyById.get(row.permissionId)
      if (!key) continue
      const map = overridesByUser.get(row.userId) || {}
      map[key] = row.allowed
      overridesByUser.set(row.userId, map)
    }

    const viewKeyBySection = sections.map((section) => ({ section, viewKey: `${section.key}.view` }))
    const access: Record<string, Record<string, { visible: boolean; override: boolean; defaultVisible: boolean }>> = {}
    for (const user of userRows) {
      const base = { ...allFalse, ...(roleDefaultsByRole.get(user.role) || {}) }
      const overrides = overridesByUser.get(user.id) || {}
      const snapshot = resolveEffectiveSnapshot(base, overrides, user.role as PermissionRole, user.brand)
      const row: Record<string, { visible: boolean; override: boolean; defaultVisible: boolean }> = {}
      for (const { section, viewKey } of viewKeyBySection) {
        row[section.key] = {
          visible: snapshot.effective[viewKey] === true,
          override: viewKey in overrides,
          defaultVisible: snapshot.roleDefaults[viewKey] === true,
        }
      }
      access[user.id] = row
    }

    return {
      users: userRows.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        brand: user.brand,
        branchLabel: getUserBranchLabel(user.brand),
        isActive: user.isActive,
      })),
      sections: sections.map((group) => ({ key: group.key, name: group.name, parentKey: group.parentKey, sortOrder: group.sortOrder })),
      access,
    }
}
