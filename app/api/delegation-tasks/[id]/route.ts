import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getDelegationTaskDetail, updateDelegationTask, getBrandEaEmails, type TaskAction } from '@/lib/delegation/tasks'
import { sendTaskAssignedEmail } from '@/lib/delegation/emails'

export const dynamic = 'force-dynamic'

const ACTIONS: TaskAction[] = ['complete', 'reopen', 'cancel', 'reassign', 'edit', 'comment', 'remind']

export async function GET(_request: Request, context: RouteContext<'/api/delegation-tasks/[id]'>) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'ceo', 'ed', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const permission = await requirePermission(appUser, 'delegation_tasks.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const { id } = await context.params
    const detail = await getDelegationTaskDetail(id, { id: appUser.id, role: appUser.role, brand: appUser.brand })
    if (!detail) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    console.error('Failed to load delegation task:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load task' }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: RouteContext<'/api/delegation-tasks/[id]'>) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'ceo', 'ed', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const permission = await requirePermission(appUser, 'delegation_tasks.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const action = String(body.action || '') as TaskAction
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
    // Relationship + role are enforced inside updateDelegationTask (assignee vs delegator vs super).
    const task = await updateDelegationTask(id, action, body, appUser)
    // Tell the assignee they now own this task or details have been updated (best-effort, post-commit); CC the brand's EA(s).
    if (action === 'reassign' || action === 'edit') {
      getBrandEaEmails(task.brand)
        .then((eaList) => {
          const eaCc = eaList.filter((e) => e.toLowerCase() !== String(task.assignedEmail || '').toLowerCase())
          return sendTaskAssignedEmail({
            toEmail: task.assignedEmail,
            toName: task.assignedName,
            assignerName: appUser.fullName,
            title: task.title,
            description: task.description,
            dueAt: task.dueAt,
            priority: task.priority,
            cc: eaCc,
            isUpdate: action === 'edit',
            isReassign: action === 'reassign'
          })
        })
        .catch((err) => {
          console.error(`[delegation-tasks-${action}] Failed to send email:`, err)
        })
    } else if (action === 'remind') {
      void sendTaskAssignedEmail({
        toEmail: task.assignedEmail,
        toName: task.assignedName,
        assignerName: appUser.fullName,
        title: task.title,
        description: task.description,
        dueAt: task.dueAt,
        priority: task.priority,
        isReminder: true
      }).catch((err) => {
        console.error(`[delegation-tasks-remind] Failed to send email:`, err)
      })
    }
    return NextResponse.json({ ok: true, task })
  } catch (error) {
    console.error('Failed to update delegation task:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update task' }, { status: 400 })
  }
}
