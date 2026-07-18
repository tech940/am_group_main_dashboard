import { NextResponse } from 'next/server'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { canDelegateTasks, concreteBrands, isAssignableUnderBrands, isGroupWideDelegation } from '@/lib/delegation/access'

export const dynamic = 'force-dynamic'

// The "assign to whom" picker for the Delegate dialog. Only delegators need it, so it is gated on
// canDelegateTasks. BRAND-SCOPED: a group-wide delegator (brand 'all' / developer) sees every active
// user; a brand delegator (e.g. a KIA MD) sees only their brand's staff + shared 'all'-brand staff.
// Filtered in JS (~55 rows) because users.brand can be comma-joined ('platinum,kia') / 'all'.
export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'ceo', 'ed', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const permission = await requirePermission(appUser, 'delegation_tasks.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  if (!canDelegateTasks(appUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, brand: users.brand })
      .from(users)
      .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName))

    const brands = concreteBrands(appUser.brand)
    const assignees = isGroupWideDelegation(appUser)
      ? rows
      : rows.filter((u) => isAssignableUnderBrands(u.brand, brands))
    return NextResponse.json({ assignees })
  } catch (error) {
    console.error('Failed to load assignees:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load assignees' }, { status: 500 })
  }
}
