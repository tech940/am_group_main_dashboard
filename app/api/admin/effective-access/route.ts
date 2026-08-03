import { NextResponse } from 'next/server'
import { and, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canSeeAdminTarget, getAdminCapabilities } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { getEffectiveAccessReport } from '@/lib/admin/effective-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Why can (or can't) a given user see a given section.
 *
 * Authorisation reuses the SAME helpers the rest of the admin console uses, so a branch admin can
 * only inspect users they already administer — this must not become a way to enumerate the whole
 * organisation's access from a narrower admin role.
 */
export async function GET(request: Request) {
  const actor = await getAuthenticatedAppUser()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!getAdminCapabilities(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const userId = new URL(request.url).searchParams.get('userId')

  // No userId: return the list of users this admin may inspect, for the picker.
  if (!userId) {
    const rows = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, brand: users.brand, isActive: users.isActive })
      .from(users)
      .where(and(isNull(users.deletedAt)))
      .orderBy(users.fullName)
    return NextResponse.json({ users: rows.filter((u) => canSeeAdminTarget(actor, u)) })
  }

  try {
    const report = await getEffectiveAccessReport(userId)
    if (!report) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (!canSeeAdminTarget(actor, { id: report.user.id, role: report.user.role, brand: report.user.brand } as never)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(report)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve effective access' },
      { status: 500 },
    )
  }
}
