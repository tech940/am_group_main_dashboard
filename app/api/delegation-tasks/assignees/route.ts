import { NextResponse } from 'next/server'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { db } from '@/lib/db'
import { users, delegationContacts } from '@/lib/db/schema'
import { canDelegateTasks, concreteBrands, isAssignableUnderBrands, isGroupWideDelegation } from '@/lib/delegation/access'

export const dynamic = 'force-dynamic'

// The "assign to whom" picker for the Delegate dialog. Only delegators need it, so it is gated on
// canDelegateTasks. BRAND-SCOPED: a group-wide delegator (brand 'all' / developer) sees every active
// user; a brand delegator (e.g. a KIA MD) sees only their brand's staff + shared 'all'-brand staff.
export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const permission = await requirePermission(appUser, 'delegation_tasks.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  if (!canDelegateTasks(appUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, brand: users.brand, phoneNumber: users.phoneNumber })
      .from(users)
      .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName))

    const contactRows = await db
      .select({ id: delegationContacts.id, name: delegationContacts.name, email: delegationContacts.email, phone: delegationContacts.phone })
      .from(delegationContacts)
      .orderBy(asc(delegationContacts.name))

    const userEmails = new Set(rows.map(u => String(u.email || '').trim().toLowerCase()).filter(Boolean))
    const userPhones = new Set(rows.map(u => String(u.phoneNumber || '').trim().replace(/\D/g, '')).filter(Boolean))

    const formattedContacts = contactRows
      .filter(c => {
        const emailMatch = c.email && userEmails.has(c.email.trim().toLowerCase())
        const phoneClean = c.phone.trim().replace(/\D/g, '')
        const phoneMatch = phoneClean && userPhones.has(phoneClean)
        return !emailMatch && !phoneMatch
      })
      .map(c => ({
        id: c.id,
        fullName: c.name,
        email: c.email || '',
        role: 'External Contact',
        brand: 'all',
        phoneNumber: c.phone,
        isExternal: true
      }))

    const brands = concreteBrands(appUser.brand)
    const baseAssignees = isGroupWideDelegation(appUser)
      ? rows
      : rows.filter((u) => isAssignableUnderBrands(u.brand, brands))

    const assignees = [...baseAssignees, ...formattedContacts]
    assignees.sort((a, b) => a.fullName.localeCompare(b.fullName))

    return NextResponse.json({ assignees })
  } catch (error) {
    console.error('Failed to load assignees:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load assignees' }, { status: 500 })
  }
}
