import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { delegationTasks } from '@/lib/db/schema'
import { eq, or, and, not } from 'drizzle-orm'
import { getScopeFilter } from '@/lib/delegation/tasks'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const name = searchParams.get('name')

  if (!email && !name) {
    return NextResponse.json({ error: 'Missing name or email parameter' }, { status: 400 })
  }

  try {
    const filters = []
    if (email) filters.push(eq(delegationTasks.assignedEmail, email))
    if (name) filters.push(eq(delegationTasks.assignedName, name))

    const scope = await getScopeFilter(appUser)
    const baseCondition = and(or(...filters), not(eq(delegationTasks.status, 'cancelled')))
    const whereClause = scope ? and(baseCondition, scope) : baseCondition

    const list = await db
      .select({
        id: delegationTasks.id,
        title: delegationTasks.title,
        description: delegationTasks.description,
        assignedTo: delegationTasks.assignedTo,
        assignedName: delegationTasks.assignedName,
        assignedEmail: delegationTasks.assignedEmail,
        dueAt: delegationTasks.dueAt,
        followUpAt: delegationTasks.followUpAt,
        status: delegationTasks.status,
        priority: delegationTasks.priority,
        brand: delegationTasks.brand,
        completionRemark: delegationTasks.completionRemark,
        completedAt: delegationTasks.completedAt,
        createdBy: delegationTasks.createdBy,
        createdAt: delegationTasks.createdAt,
        updatedAt: delegationTasks.updatedAt,
      })
      .from(delegationTasks)
      .where(whereClause)
      .orderBy(delegationTasks.dueAt)

    return NextResponse.json({ tasks: list })
  } catch (error) {
    console.error('Failed to load performance breakdown:', error)
    return NextResponse.json({ error: 'Failed to load performance breakdown' }, { status: 500 })
  }
}
