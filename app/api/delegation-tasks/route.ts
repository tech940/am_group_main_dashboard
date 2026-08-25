import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { canDelegateTasks, isGroupWideDelegation } from '@/lib/delegation/access'
import { createDelegationTask, listDelegationTasks, getDelegationBrandRollup } from '@/lib/delegation/tasks'
import { sendTaskAssignedEmail } from '@/lib/delegation/emails'

export const dynamic = 'force-dynamic'

// Cross-brand (common) section — no requireBrandApiAccess; gate on the section permission only, then
// gate WRITES by role (canDelegateTasks) since a permission cannot restrict who may delegate. Brand
// scoping is enforced inside lib/delegation/tasks.ts against the viewer's users.brand.

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const permission = await requirePermission(appUser, 'delegation_tasks.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const url = new URL(request.url)
    const tabParam = url.searchParams.get('tab')
    const tab = tabParam === 'mine' || tabParam === 'delegated' || tabParam === 'all' ? tabParam : null
    const viewer = { id: appUser.id, role: appUser.role, brand: appUser.brand }
    const groupWide = isGroupWideDelegation(appUser)
    const rows = await listDelegationTasks({
      tab,
      status: url.searchParams.get('status'),
      priority: url.searchParams.get('priority'),
      search: url.searchParams.get('search'),
      brand: url.searchParams.get('brand'),
    }, viewer)
    // The cross-branch rollup is a group-wide-only surface.
    const rollup = groupWide ? await getDelegationBrandRollup() : null
    return NextResponse.json({ rows, rollup, canDelegate: canDelegateTasks(appUser.role), groupWide })
  } catch (error) {
    console.error('Failed to list delegation tasks:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load tasks' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const permission = await requirePermission(appUser, 'delegation_tasks.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  if (!canDelegateTasks(appUser.role)) {
    return NextResponse.json({ error: 'You are not allowed to delegate tasks.' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const task = await createDelegationTask(body, appUser)
    // Best-effort assignment email AFTER the task is committed — the task must not fail if mail does.
    // Email is sent directly to the assigned user only.
    sendTaskAssignedEmail({
      toEmail: task.assignedEmail,
      toName: task.assignedName,
      assignerName: appUser.fullName,
      // Puts the delegator on Cc and Reply-To so the assignee's reply reaches them, not tech@.
      assignerEmail: appUser.email,
      title: task.title,
      description: task.description,
      dueAt: task.dueAt,
      priority: task.priority,
    }).catch((err) => {
      console.error('[delegation-tasks] Failed to send assignment email:', err)
    })
    return NextResponse.json({ ok: true, task })
  } catch (error) {
    console.error('Failed to create delegation task:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create task' }, { status: 400 })
  }
}
