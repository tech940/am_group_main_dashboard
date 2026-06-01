import { NextResponse } from 'next/server'
import { and, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isUserBranchValue } from '@/lib/branches'
import {
  BRANCH_MODULE_ACCESS_ROLE_KEEP,
  buildBranchModuleAccessPermissionChanges,
  canUseBranchModuleAccessRole,
  isBranchModuleAccessRoleEditValue,
  isBranchModuleAccessRoleValue,
  type BranchModuleAccessRoleEditValue,
  type BranchModuleAccessRoleValue,
} from '@/lib/branch-module-access'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { isMissingPermissionTableError, updateUserPermissionOverrides } from '@/lib/permissions/service'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function canAccessAdminPanel(role: string | null | undefined) {
  return role === 'admin' || role === 'md'
}

function normalizeUserBranchAccess(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return isUserBranchValue(value) ? value : undefined
}

function normalizeCreateBranchModuleRole(value: unknown): BranchModuleAccessRoleValue {
  return isBranchModuleAccessRoleValue(value) ? value : 'inherit'
}

function normalizeEditBranchModuleRole(value: unknown): BranchModuleAccessRoleEditValue {
  return isBranchModuleAccessRoleEditValue(value) ? value : BRANCH_MODULE_ACCESS_ROLE_KEEP
}

async function applyBranchModuleRolePreset(params: {
  targetUserId: string
  changedByUserId: string
  branchAccess: string | null | undefined
  role: BranchModuleAccessRoleValue
}) {
  const changes = buildBranchModuleAccessPermissionChanges(params.branchAccess, params.role)
  if (Object.keys(changes).length === 0) return null

  try {
    await updateUserPermissionOverrides({
      targetUserId: params.targetUserId,
      changedByUserId: params.changedByUserId,
      changes,
      reason: `Applied branch module role preset: ${params.role}`,
    })
    return null
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return 'Branch module role was not applied because permission tables are not installed. Run npm run db:setup-permissions-manager.'
    }
    throw error
  }
}

// GET - Fetch paginated users
export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser || !canAccessAdminPanel(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(10, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '10', 10) || 10))
    const search = (searchParams.get('search') || '').trim()
    const role = searchParams.get('role') || 'all'
    const department = searchParams.get('department') || 'all'
    const branch = searchParams.get('branch') || 'any'
    const status = searchParams.get('status') || 'all'

    const conditions = [isNull(users.deletedAt)]

    if (search) {
      conditions.push(or(
        ilike(users.fullName, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(users.department, `%${search}%`)
      )!)
    }

    if (role !== 'all') {
      conditions.push(eq(users.role, role as typeof users.role.enumValues[number]))
    }

    if (department !== 'all') {
      conditions.push(ilike(users.department, department))
    }

    if (branch !== 'any') {
      conditions.push(eq(users.brand, branch))
    }

    if (status !== 'all') {
      conditions.push(eq(users.isActive, status === 'active'))
    }

    const whereClause = and(...conditions)
    const offset = (page - 1) * pageSize

    const [totalResult] = await db.select({ total: count() })
      .from(users)
      .where(whereClause)

    const [summaryResult] = await db.select({
      totalUsers: count(),
      admins: sql<number>`count(*) filter (where ${users.role} = 'admin')`,
      managers: sql<number>`count(*) filter (where ${users.role} in ('manager', 'purchase_manager'))`,
      active: sql<number>`count(*) filter (where ${users.isActive} = true)`,
    })
      .from(users)
      .where(isNull(users.deletedAt))

    const departmentRows = await db.selectDistinct({ department: users.department })
      .from(users)
      .where(and(isNull(users.deletedAt), isNotNull(users.department)))
      .orderBy(users.department)

    const allUsers = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      brand: users.brand,
      department: users.department,
      phoneNumber: users.phoneNumber,
      isActive: users.isActive,
      createdAt: users.createdAt,
    }).from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset)

    const total = Number(totalResult?.total || 0)

    return NextResponse.json({
      users: allUsers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      summary: {
        totalUsers: Number(summaryResult?.totalUsers || 0),
        admins: Number(summaryResult?.admins || 0),
        managers: Number(summaryResult?.managers || 0),
        active: Number(summaryResult?.active || 0),
      },
      filterOptions: {
        departments: departmentRows
          .map((row) => row.department)
          .filter((value): value is string => Boolean(value?.trim())),
      },
    })
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

// POST - Create new user
export async function POST(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser || !canAccessAdminPanel(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { email, fullName, password, role, brand, department, branchModuleRole } = body

    // Validate required fields
    if (!email || !fullName || !password || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: email, fullName, password, role' },
        { status: 400 }
      )
    }

    const normalizedBrand = normalizeUserBranchAccess(brand)

    if (normalizedBrand === undefined) {
      return NextResponse.json(
        { error: 'Invalid branch access selected' },
        { status: 400 }
      )
    }

    if (branchModuleRole !== undefined && !isBranchModuleAccessRoleValue(branchModuleRole)) {
      return NextResponse.json(
        { error: 'Invalid branch module role selected' },
        { status: 400 }
      )
    }

    const normalizedBranchModuleRole = normalizeCreateBranchModuleRole(branchModuleRole)

    if (
      normalizedBranchModuleRole !== 'inherit'
      && !canUseBranchModuleAccessRole(normalizedBrand)
    ) {
      return NextResponse.json(
        { error: 'Select a branch before applying branch module access' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      )
    }

    // Create user in Supabase Auth first using admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      }
    })

    if (authError || !authData.user) {
      console.error('Supabase auth error:', authError)
      return NextResponse.json(
        { error: authError?.message || 'Failed to create auth user' },
        { status: 500 }
      )
    }

    // Create user profile in our database
    const [newUser] = await db.insert(users).values({
      supabaseId: authData.user.id,
      email,
      fullName,
      role,
      brand: normalizedBrand,
      department: department || null,
      isActive: true,
    }).returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      brand: users.brand,
      department: users.department,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })

    const permissionWarning = normalizedBranchModuleRole !== 'inherit' && canUseBranchModuleAccessRole(normalizedBrand)
      ? await applyBranchModuleRolePreset({
        targetUserId: newUser.id,
        changedByUserId: appUser.id,
        branchAccess: normalizedBrand,
        role: normalizedBranchModuleRole,
      })
      : null

    return NextResponse.json({ ...newUser, permissionWarning }, { status: 201 })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    )
  }
}

// PUT - Update user
export async function PUT(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser || !canAccessAdminPanel(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { id, branchModuleRole, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (branchModuleRole !== undefined && !isBranchModuleAccessRoleEditValue(branchModuleRole)) {
      return NextResponse.json(
        { error: 'Invalid branch module role selected' },
        { status: 400 }
      )
    }

    const [existingUser] = await db.select({
      id: users.id,
      email: users.email,
      supabaseId: users.supabaseId,
      fullName: users.fullName,
    })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if ('brand' in updateData) {
      const normalizedBrand = normalizeUserBranchAccess(updateData.brand)

      if (normalizedBrand === undefined) {
        return NextResponse.json(
          { error: 'Invalid branch access selected' },
          { status: 400 }
        )
      }

      updateData.brand = normalizedBrand
    }

    if (typeof updateData.email === 'string') {
      updateData.email = updateData.email.trim().toLowerCase()

      if (!updateData.email) {
        return NextResponse.json({ error: 'Email is required' }, { status: 400 })
      }

      if (updateData.email !== existingUser.email) {
        const duplicateUser = await db.select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, updateData.email), ne(users.id, id), isNull(users.deletedAt)))
          .limit(1)

        if (duplicateUser.length > 0) {
          return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 })
        }
      }
    }

    const authUpdates: Record<string, unknown> = {}
    if (typeof updateData.email === 'string' && updateData.email !== existingUser.email) {
      authUpdates.email = updateData.email
      authUpdates.email_confirm = true
    }
    if (typeof updateData.fullName === 'string' && updateData.fullName !== existingUser.fullName) {
      authUpdates.user_metadata = { full_name: updateData.fullName }
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.supabaseId,
        authUpdates
      )

      if (authError) {
        console.error('Error updating Supabase Auth user:', authError)
        return NextResponse.json(
          { error: authError.message || 'Failed to update authentication user' },
          { status: 500 }
        )
      }
    }

    const [updatedUser] = await db.update(users)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning()

    if (!updatedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const normalizedBranchModuleRole = normalizeEditBranchModuleRole(branchModuleRole)
    const permissionWarning = normalizedBranchModuleRole !== BRANCH_MODULE_ACCESS_ROLE_KEEP
      && canUseBranchModuleAccessRole(updatedUser.brand)
      ? await applyBranchModuleRolePreset({
        targetUserId: updatedUser.id,
        changedByUserId: appUser.id,
        branchAccess: updatedUser.brand,
        role: normalizedBranchModuleRole,
      })
      : null

    return NextResponse.json({ ...updatedUser, permissionWarning })
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

// DELETE - Delete user from both Supabase Auth and database
export async function DELETE(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser || !canAccessAdminPanel(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Get user's supabaseId before deleting
    const [user] = await db.select({
      id: users.id,
      supabaseId: users.supabaseId,
      email: users.email
    })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Delete from Supabase Auth first
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(user.supabaseId)
    
    if (authError) {
      console.error('Error deleting from Supabase Auth:', authError)
      // Continue with database deletion even if auth deletion fails
    }

    // Soft delete from database
    await db.update(users)
      .set({
        deletedAt: new Date(),
        isActive: false
      })
      .where(eq(users.id, id))

    return NextResponse.json({ success: true, message: 'User deleted successfully' })
  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}

// Made with Bob
