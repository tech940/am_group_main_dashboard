import { NextResponse } from 'next/server'
import { and, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { clearAppUserCache, getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import {
  canAssignRole,
  canManageAdminTarget,
  canSeeAdminTarget,
  getAdminCapabilities,
  resolveManagedBranch,
  writeAdminAudit,
} from '@/lib/admin/authorization'
import {
  BRANCH_MODULE_ACCESS_ROLE_KEEP,
  buildBranchModuleAccessPermissionChanges,
  canUseBranchModuleAccessRole,
  isBranchModuleAccessRoleEditValue,
  isBranchModuleAccessRoleValue,
  type BranchModuleAccessRoleValue,
} from '@/lib/branch-module-access'
import { isUserBranchValue } from '@/lib/branches'
import { normalizeDealers } from '@/lib/admin/normalize-dealers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import {
  clearUserPermissionCache,
  isMissingPermissionTableError,
  updateUserPermissionOverrides,
} from '@/lib/permissions/service'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const BULK_CREATE_LIMIT = 50
const VALID_ROLES = users.role.enumValues

type CreateUserInput = {
  email?: unknown
  fullName?: unknown
  password?: unknown
  role?: unknown
  brand?: unknown
  dealers?: unknown
  department?: unknown
  phoneNumber?: unknown
  branchModuleRole?: unknown
}

// Dealer/branch scope only applies to a single concrete brand that has a dealer registry.
// Anything else (no brand, 'all', or multi-brand) clears the scope to null (= all branches).

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Surfaces the underlying cause of an otherwise-generic 500. In development we
// return the real error text (Postgres/Supabase message) so failures are
// debuggable instead of a blank "Failed to ...". Production keeps the generic
// fallback so internal details are never leaked to end users.
function errorResponseMessage(fallback: string, error: unknown) {
  if (process.env.NODE_ENV === 'production') return fallback
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return detail ? `${fallback} (${detail})` : fallback
}

function normalizeRequestedBranch(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) {
    const vals = value.filter(v => typeof v === 'string' && isUserBranchValue(v))
    if (vals.length === 0) return undefined
    if (vals.includes('all')) return 'all'
    return vals.join(',')
  }
  if (typeof value === 'string') {
    if (value.includes(',')) {
      const vals = value.split(',').map(v => v.trim()).filter(isUserBranchValue)
      if (vals.length === 0) return undefined
      if (vals.includes('all')) return 'all'
      return vals.join(',')
    }
    return isUserBranchValue(value) ? value : undefined
  }
  return undefined
}

function publicUser(user: typeof users.$inferSelect, actor: AppUser) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    brand: user.brand,
    dealers: user.dealers,
    department: user.department,
    phoneNumber: user.phoneNumber,
    isActive: user.isActive,
    lastSeenAt: user.lastSeenAt,
    // Resolved here rather than in the table cell: relative time from Date.now() during render is
    // impure and the React Compiler rejects it. "As of this request" is the right basis anyway.
    idleHours: user.lastSeenAt
      ? Math.floor((Date.now() - user.lastSeenAt.getTime()) / 3_600_000)
      : null,
    createdBy: user.createdBy,
    updatedBy: user.updatedBy,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    capabilities: {
      canManage: canManageAdminTarget(actor, user),
      canChangePermissions: canManageAdminTarget(actor, user),
      managedBySuperAdmin: canSeeAdminTarget(actor, user) && !canManageAdminTarget(actor, user),
    },
  }
}

async function applyBranchModulePreset(params: {
  targetUserId: string
  actor: AppUser
  branch: string | null
  preset: BranchModuleAccessRoleValue
}) {
  const changes = buildBranchModuleAccessPermissionChanges(params.branch, params.preset)
  if (Object.keys(changes).length === 0) return null

  try {
    await updateUserPermissionOverrides({
      targetUserId: params.targetUserId,
      changedByUserId: params.actor.id,
      changes,
      reason: `Applied branch module role preset: ${params.preset}`,
    })
    return null
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return 'Permission tables are not installed; the user was created without optional overrides.'
    }
    throw error
  }
}

function normalizeCreateInput(input: CreateUserInput, actor: AppUser) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const role = typeof input.role === 'string' ? input.role.trim() : ''
  const requestedBranch = normalizeRequestedBranch(input.brand)

  if (!email || !fullName || !password || !role) {
    return { error: 'Email, full name, password, and role are required.' } as const
  }
  if (!VALID_ROLES.includes(role as AppUser['role']) || role === 'admin') {
    return { error: 'The selected role is invalid or deprecated.' } as const
  }
  if (!canAssignRole(actor, role as AppUser['role'])) {
    return { error: 'You are not authorized to assign this role.' } as const
  }
  if (requestedBranch === undefined) {
    return { error: 'Invalid branch assignment.' } as const
  }

  const branch = resolveManagedBranch(actor, requestedBranch)
  if (branch === undefined) return { error: 'Invalid branch assignment.' } as const
  if (role === 'branch_admin' && (!branch || branch === 'all')) {
    return { error: 'Branch Admin must be assigned to exactly one branch.' } as const
  }
  if (getAdminCapabilities(actor)?.authority === 'branch_admin' && (!branch || branch === 'all')) {
    return { error: 'Branch users must remain assigned to your branch.' } as const
  }

  const branchModuleRole = isBranchModuleAccessRoleValue(input.branchModuleRole)
    ? input.branchModuleRole
    : 'inherit'

  return {
    email,
    fullName,
    password,
    role: role as AppUser['role'],
    branch,
    dealers: normalizeDealers(branch, input.dealers),
    department: normalizeOptionalString(input.department),
    phoneNumber: normalizeOptionalString(input.phoneNumber),
    branchModuleRole,
  } as const
}

async function createUser(input: CreateUserInput, actor: AppUser, request: Request) {
  const normalized = normalizeCreateInput(input, actor)
  if ('error' in normalized) return { ok: false, error: normalized.error } as const

  const duplicate = await db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, normalized.email), isNull(users.deletedAt)))
    .limit(1)
  if (duplicate.length > 0) return { ok: false, error: 'User with this email already exists.' } as const

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: normalized.email,
    password: normalized.password,
    email_confirm: true,
    user_metadata: { full_name: normalized.fullName },
  })
  if (error || !data.user) return { ok: false, error: error?.message || 'Failed to create authentication user.' } as const

  let createdUser: typeof users.$inferSelect | null = null
  try {
    const [created] = await db.insert(users).values({
      supabaseId: data.user.id,
      email: normalized.email,
      fullName: normalized.fullName,
      role: normalized.role,
      brand: normalized.branch,
      dealers: normalized.dealers,
      department: normalized.department,
      phoneNumber: normalized.phoneNumber,
      createdBy: actor.id,
      updatedBy: actor.id,
      isActive: true,
    }).returning()
    createdUser = created

    const warning = normalized.branchModuleRole !== 'inherit' && canUseBranchModuleAccessRole(created.brand)
      ? await applyBranchModulePreset({
        targetUserId: created.id,
        actor,
        branch: created.brand,
        preset: normalized.branchModuleRole,
      })
      : null

    await writeAdminAudit({
      actor,
      action: 'user.created',
      targetUserId: created.id,
      branch: created.brand,
      after: publicUser(created, actor),
      request,
    })

    return { ok: true, user: created, warning } as const
  } catch (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => null)
    if (createdUser) {
      await db.delete(users).where(eq(users.id, createdUser.id)).catch(() => null)
    }
    throw insertError
  }
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    const actorCapabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !actorCapabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '20', 10) || 20))
    const search = (searchParams.get('search') || '').trim()
    const role = searchParams.get('role') || 'all'
    const department = searchParams.get('department') || 'all'
    const branch = searchParams.get('branch') || 'any'
    const status = searchParams.get('status') || 'all'
    const conditions = [isNull(users.deletedAt)]

    if (actorCapabilities.authority === 'branch_admin') {
      conditions.push(eq(users.brand, actorCapabilities.branch!))
    }
    if (search) {
      conditions.push(or(
        ilike(users.fullName, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(users.department, `%${search}%`)
      )!)
    }
    if (role !== 'all' && VALID_ROLES.includes(role as AppUser['role'])) {
      conditions.push(eq(users.role, role as AppUser['role']))
    }
    if (department !== 'all') conditions.push(ilike(users.department, department))
    if (branch !== 'any' && actorCapabilities.authority === 'developer') conditions.push(eq(users.brand, branch))
    if (status !== 'all') conditions.push(eq(users.isActive, status === 'active'))

    const where = and(...conditions)
    const scope = actorCapabilities.authority === 'branch_admin'
      ? and(isNull(users.deletedAt), eq(users.brand, actorCapabilities.branch!))
      : isNull(users.deletedAt)

    const [[totalRow], [summary], departmentRows, rows] = await Promise.all([
      db.select({ total: count() }).from(users).where(where),
      db.select({
        totalUsers: count(),
        administrators: sql<number>`count(*) filter (where ${users.role} in ('admin', 'developer', 'branch_admin'))`,
        managers: sql<number>`count(*) filter (where ${users.role} = 'manager')`,
        active: sql<number>`count(*) filter (where ${users.isActive} = true)`,
        inactive: sql<number>`count(*) filter (where ${users.isActive} = false)`,
      }).from(users).where(scope),
      db.selectDistinct({ department: users.department })
        .from(users)
        .where(and(scope, isNotNull(users.department)))
        .orderBy(users.department),
      db.select().from(users)
        .where(where)
        .orderBy(desc(users.updatedAt), desc(users.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ])

    const total = Number(totalRow?.total || 0)
    return NextResponse.json({
      users: rows.map((user) => publicUser(user, actor)),
      actorCapabilities,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: {
        totalUsers: Number(summary?.totalUsers || 0),
        administrators: Number(summary?.administrators || 0),
        managers: Number(summary?.managers || 0),
        active: Number(summary?.active || 0),
        inactive: Number(summary?.inactive || 0),
      },
      filterOptions: {
        departments: departmentRows.map((row) => row.department).filter((value): value is string => Boolean(value)),
        roles: actorCapabilities.assignableRoles,
      },
    })
  } catch (error) {
    console.error('GET /api/admin/users failed:', error)
    return NextResponse.json({ error: 'Failed to load users.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    if (!actor || !getAdminCapabilities(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await request.json()

    if (Array.isArray(body.bulkUsers)) {
      if (body.bulkUsers.length === 0 || body.bulkUsers.length > BULK_CREATE_LIMIT) {
        return NextResponse.json({ error: `Bulk creation requires 1-${BULK_CREATE_LIMIT} users.` }, { status: 400 })
      }
      const results = []
      for (const [index, input] of (body.bulkUsers as CreateUserInput[]).entries()) {
        try {
          const result = await createUser(input, actor, request)
          results.push(result.ok
            ? { index, status: 'created', user: publicUser(result.user, actor), permissionWarning: result.warning }
            : { index, status: 'failed', error: result.error })
        } catch (error) {
          console.error('Bulk user creation failed:', error)
          results.push({ index, status: 'failed', error: 'Failed to create user.' })
        }
      }
      const created = results.filter((result) => result.status === 'created').length
      return NextResponse.json({ created, failed: results.length - created, results }, { status: created ? 201 : 400 })
    }

    const result = await createUser(body, actor, request)
    if (!result.ok) {
      const message = result.error || 'Failed to create user.'
      return NextResponse.json({ error: message }, { status: message.includes('already exists') ? 409 : 400 })
    }
    return NextResponse.json({
      ...publicUser(result.user, actor),
      permissionWarning: result.warning,
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/admin/users failed:', error)
    return NextResponse.json({ error: errorResponseMessage('Failed to create user.', error) }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    if (!actor || !getAdminCapabilities(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await request.json()
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })

    const [existing] = await db.select().from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
    if (!existing) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    if (!canManageAdminTarget(actor, existing)) {
      return NextResponse.json({ error: 'This user is managed by Developer.' }, { status: 403 })
    }

    if (typeof body.expectedUpdatedAt === 'string' && existing.updatedAt.toISOString() !== body.expectedUpdatedAt) {
      return NextResponse.json({ error: 'This user changed since it was opened. Refresh and try again.' }, { status: 409 })
    }

    const actorCapabilities = getAdminCapabilities(actor)!
    const updates: Partial<typeof users.$inferInsert> = {
      updatedBy: actor.id,
      updatedAt: new Date(),
    }

    if (typeof body.fullName === 'string' && body.fullName.trim()) updates.fullName = body.fullName.trim()
    if (typeof body.department === 'string' || body.department === null) updates.department = normalizeOptionalString(body.department)
    if (typeof body.phoneNumber === 'string' || body.phoneNumber === null) updates.phoneNumber = normalizeOptionalString(body.phoneNumber)
    if (typeof body.isActive === 'boolean') {
      updates.isActive = body.isActive
      // Reactivating alone would be pointless: last_seen_at is still weeks stale, so the next
      // auto-deactivation sweep (hourly) would immediately deactivate them again and the admin's
      // action would silently undo itself. Give the account a fresh idle window to come back in.
      if (body.isActive && !existing.isActive) updates.lastSeenAt = new Date()
    }

    const authUpdates: Record<string, unknown> = {}

    if (actorCapabilities.authority === 'developer') {
      if (typeof body.role === 'string') {
        if (!VALID_ROLES.includes(body.role as AppUser['role']) || !canAssignRole(actor, body.role as AppUser['role'])) {
          return NextResponse.json({ error: 'You cannot assign this role.' }, { status: 400 })
        }
        updates.role = body.role as AppUser['role']
      }
      if ('brand' in body) {
        const requestedBranch = normalizeRequestedBranch(body.brand)
        if (requestedBranch === undefined) return NextResponse.json({ error: 'Invalid branch assignment.' }, { status: 400 })
        const nextRole = (updates.role || existing.role) as AppUser['role']
        if (nextRole === 'branch_admin' && (!requestedBranch || requestedBranch === 'all')) {
          return NextResponse.json({ error: 'Branch Admin must have exactly one branch.' }, { status: 400 })
        }
        updates.brand = requestedBranch
      }
      if ('dealers' in body || 'brand' in body) {
        const effectiveBrand = (updates.brand ?? existing.brand) as string | null
        updates.dealers = normalizeDealers(effectiveBrand, 'dealers' in body ? body.dealers : existing.dealers)
      }
      if (typeof body.email === 'string' && body.email.trim()) {
        const email = body.email.trim().toLowerCase()
        const duplicate = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.email, email), ne(users.id, id), isNull(users.deletedAt)))
          .limit(1)
        if (duplicate.length) return NextResponse.json({ error: 'User with this email already exists.' }, { status: 409 })
        updates.email = email
      }
      if (typeof body.password === 'string' && body.password) {
        if (body.password.length < 6) {
          return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
        }
        authUpdates.password = body.password
      }
    } else if ('role' in body || 'brand' in body || 'email' in body) {
      return NextResponse.json({ error: 'Branch Admin cannot change role, branch, or login email.' }, { status: 403 })
    }

    if (updates.email && updates.email !== existing.email) {
      authUpdates.email = updates.email
      authUpdates.email_confirm = true
    }
    if (updates.fullName && updates.fullName !== existing.fullName) {
      authUpdates.user_metadata = { full_name: updates.fullName }
    }
    if (Object.keys(authUpdates).length) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(existing.supabaseId, authUpdates)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning()
    const preset = isBranchModuleAccessRoleEditValue(body.branchModuleRole)
      ? body.branchModuleRole
      : BRANCH_MODULE_ACCESS_ROLE_KEEP
    const permissionWarning = preset !== BRANCH_MODULE_ACCESS_ROLE_KEEP && canUseBranchModuleAccessRole(updated.brand)
      ? await applyBranchModulePreset({
        targetUserId: updated.id,
        actor,
        branch: updated.brand,
        preset,
      })
      : null

    await Promise.all([
      clearUserPermissionCache(updated.id),
      writeAdminAudit({
        actor,
        action: existing.isActive !== updated.isActive
          ? (updated.isActive ? 'user.reactivated' : 'user.deactivated')
          : 'user.updated',
        targetUserId: updated.id,
        branch: updated.brand,
        before: publicUser(existing, actor),
        after: publicUser(updated, actor),
        reason: normalizeOptionalString(body.reason),
        request,
      }),
    ])
    clearAppUserCache(updated.supabaseId)

    return NextResponse.json({ ...publicUser(updated, actor), permissionWarning })
  } catch (error) {
    console.error('PUT /api/admin/users failed:', error)
    return NextResponse.json({ error: errorResponseMessage('Failed to update user.', error) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    const actorCapabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || actorCapabilities?.authority !== 'developer') {
      return NextResponse.json({ error: 'Only Developer can permanently delete users.' }, { status: 403 })
    }

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })
    const [target] = await db.select().from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    if (!canManageAdminTarget(actor, target)) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 403 })

    const { error } = await supabaseAdmin.auth.admin.deleteUser(target.supabaseId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await db.update(users).set({
      isActive: false,
      deletedAt: new Date(),
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(users.id, target.id))
    await writeAdminAudit({
      actor,
      action: 'user.permanently_deleted',
      targetUserId: target.id,
      branch: target.brand,
      before: publicUser(target, actor),
      reason: new URL(request.url).searchParams.get('reason'),
      request,
    })
    clearAppUserCache(target.supabaseId)
    await clearUserPermissionCache(target.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/admin/users failed:', error)
    return NextResponse.json({ error: errorResponseMessage('Failed to delete user.', error) }, { status: 500 })
  }
}
