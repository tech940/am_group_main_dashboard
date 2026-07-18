import 'server-only'
import { and, desc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { delegationTaskActivity, delegationTasks, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { canDelegateTasks, concreteBrands, isAssignableUnderBrands, isGroupWideDelegation, parseBrands, resolveTaskBrand } from '@/lib/delegation/access'

// ── Validation vocabularies (text columns, checked here rather than as a pgEnum) ──────────────────
export const TASK_STATUSES = ['assigned', 'in_progress', 'done', 'cancelled'] as const
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

const text = (v: unknown) => String(v ?? '').trim()
const nullableText = (v: unknown) => { const s = text(v); return s || null }

// ── Types ─────────────────────────────────────────────────────────────────────────────────────
type Viewer = Pick<AppUser, 'id' | 'role' | 'brand'>

export type TaskListInput = {
  tab?: 'mine' | 'delegated' | 'all' | null
  status?: string | null
  priority?: string | null
  search?: string | null
  brand?: string | null
}

export type CreateTaskInput = {
  title: string
  description?: string | null
  assignedTo: string
  dueAt?: string | null
  priority?: string | null
  brand?: string | null
  dealerCode?: string | null
}

export type TaskAction = 'start' | 'complete' | 'reopen' | 'cancel' | 'reassign' | 'edit'
export type UpdateTaskInput = {
  completionRemark?: string | null
  assignedTo?: string | null
  title?: string | null
  description?: string | null
  dueAt?: string | null
  priority?: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Resolve a user id to an active, non-deleted user or throw — used for assignee validation. */
async function resolveActiveUser(runner: DbOrTx, id: string) {
  const [u] = await runner
    .select({ id: users.id, fullName: users.fullName, email: users.email, brand: users.brand })
    .from(users)
    .where(and(eq(users.id, id), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1)
  if (!u) throw new Error('Assignee is not an active user.')
  return u
}

/**
 * A scoped delegator may only assign to their own brand's staff (or shared 'all' staff); a group-wide
 * delegator may assign to anyone. Enforced server-side so the client picker can't be bypassed.
 */
function assertCanAssign(actor: AppUser, assigneeBrand: string | null | undefined) {
  if (isGroupWideDelegation(actor)) return
  const brands = concreteBrands(actor.brand)
  if (!isAssignableUnderBrands(assigneeBrand, brands)) {
    throw new Error('You can only assign tasks to employees of your own brand.')
  }
}

async function addActivity(
  runner: DbOrTx,
  taskId: string,
  type: string,
  message: string | null,
  actor: AppUser,
) {
  await runner.insert(delegationTaskActivity).values({
    taskId,
    type,
    message,
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
  })
}

/**
 * The row-visibility predicate:
 *  - GROUP-WIDE (brand 'all' / developer) → all tasks, every brand.
 *  - a brand DELEGATOR → every task in their brand(s) (oversight) OR created-by/assigned-to them.
 *  - a pure assignee → only created-by/assigned-to them.
 * Fail closed: an unidentifiable viewer sees nothing (mirrors lib/kia/bookings.ts).
 */
function scopeFilter(viewer: Viewer) {
  if (isGroupWideDelegation(viewer)) return undefined
  if (!viewer.id) return sql`false`
  const own = or(eq(delegationTasks.createdBy, viewer.id), eq(delegationTasks.assignedTo, viewer.id))
  const brands = concreteBrands(viewer.brand)
  if (canDelegateTasks(viewer.role) && brands.length) {
    return or(own, inArray(delegationTasks.brand, brands))
  }
  return own
}

function decorate(row: typeof delegationTasks.$inferSelect, viewer: Viewer) {
  const isCreator = row.createdBy === viewer.id
  const isAssignee = row.assignedTo === viewer.id
  const canManage = isCreator || isGroupWideDelegation(viewer)
  const isOverdue = Boolean(
    row.dueAt && (row.status === 'assigned' || row.status === 'in_progress') && new Date(row.dueAt) < new Date(),
  )
  const isEa = String(viewer.role || '').trim().toLowerCase() === 'ea'
  return { ...row, viewerIsCreator: isCreator, viewerIsAssignee: isAssignee, viewerCanManage: canManage, viewerIsEa: isEa, isOverdue }
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────
export async function listDelegationTasks(input: TaskListInput, viewer: Viewer) {
  const filters = [] as (ReturnType<typeof eq> | ReturnType<typeof or> | ReturnType<typeof sql>)[]
  const scope = scopeFilter(viewer)
  if (scope) filters.push(scope)

  // Tab narrows WITHIN the scope: 'mine' = assigned to me, 'delegated' = created by me, 'all' = the
  // whole scope. 'delegated'/'all' collapse to the scope for a pure assignee (they created nothing).
  if (input.tab === 'mine' && viewer.id) filters.push(eq(delegationTasks.assignedTo, viewer.id))
  if (input.tab === 'delegated' && viewer.id) filters.push(eq(delegationTasks.createdBy, viewer.id))

  const status = text(input.status)
  if (status && status !== 'all' && (TASK_STATUSES as readonly string[]).includes(status)) {
    filters.push(eq(delegationTasks.status, status))
  }
  const priority = text(input.priority)
  if (priority && priority !== 'all' && (TASK_PRIORITIES as readonly string[]).includes(priority)) {
    filters.push(eq(delegationTasks.priority, priority))
  }
  const search = text(input.search)
  if (search) {
    const like = `%${search}%`
    filters.push(or(ilike(delegationTasks.title, like), ilike(delegationTasks.assignedName, like))!)
  }
  // Brand drill-down (the group-MD rollup links here). scopeFilter already caps a scoped viewer to
  // their own brands, so this only ever NARROWS within what the viewer may already see.
  const brand = text(input.brand).toLowerCase()
  if (brand && brand !== 'all') {
    if (brand === 'unbranded') {
      filters.push(or(isNull(delegationTasks.brand), eq(delegationTasks.brand, ''))!)
    } else {
      filters.push(eq(delegationTasks.brand, brand))
    }
  }

  const rows = await db
    .select()
    .from(delegationTasks)
    .where(filters.length ? and(...filters) : undefined)
    // Open first, then by due date (soonest / overdue first), then newest.
    .orderBy(
      sql`case when ${delegationTasks.status} in ('assigned','in_progress') then 0 else 1 end`,
      sql`${delegationTasks.dueAt} asc nulls last`,
      desc(delegationTasks.createdAt),
    )
    .limit(500)

  return rows.map((r) => decorate(r, viewer))
}

export async function getDelegationTaskDetail(id: string, viewer: Viewer) {
  const scope = scopeFilter(viewer)
  const [row] = await db
    .select()
    .from(delegationTasks)
    .where(scope ? and(eq(delegationTasks.id, id), scope) : eq(delegationTasks.id, id))
    .limit(1)
  if (!row) return null

  const activity = await db
    .select()
    .from(delegationTaskActivity)
    .where(eq(delegationTaskActivity.taskId, id))
    .orderBy(desc(delegationTaskActivity.createdAt))
    .limit(200)

  return { task: decorate(row, viewer), activity }
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────────
export async function createDelegationTask(input: CreateTaskInput, actor: AppUser) {
  if (!canDelegateTasks(actor.role)) throw new Error('You are not allowed to delegate tasks.')
  const title = text(input.title)
  if (!title) throw new Error('A task title is required.')
  const assignedTo = text(input.assignedTo)
  if (!assignedTo) throw new Error('An assignee is required.')

  const priority = text(input.priority) || 'normal'
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) throw new Error('Invalid priority.')

  return db.transaction(async (tx) => {
    const assignee = await resolveActiveUser(tx, assignedTo)
    assertCanAssign(actor, assignee.brand)
    // The task's brand = the delegator's brand (a KIA MD's tasks are KIA), or the assignee's branch
    // when the delegator is group-wide (brand='all'). This is what the per-branch rollup groups on.
    const taskBrand = resolveTaskBrand(actor.brand, assignee.brand)
    const [task] = await tx
      .insert(delegationTasks)
      .values({
        title,
        description: nullableText(input.description),
        assignedTo: assignee.id,
        assignedName: assignee.fullName,
        assignedEmail: assignee.email,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: 'assigned',
        priority,
        brand: taskBrand,
        dealerCode: nullableText(input.dealerCode),
        createdBy: actor.id,
      })
      .returning()
    await addActivity(tx, task.id, 'assigned', `Assigned to ${assignee.fullName}`, actor)
    return task
  })
}

export async function updateDelegationTask(id: string, action: TaskAction, input: UpdateTaskInput, actor: AppUser) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(delegationTasks).where(eq(delegationTasks.id, id)).limit(1)
    if (!task) throw new Error('Task not found.')

    const isAssignee = task.assignedTo === actor.id
    const isManager = task.createdBy === actor.id || isGroupWideDelegation(actor)
    const isOpen = task.status === 'assigned' || task.status === 'in_progress'

    const updates: Partial<typeof delegationTasks.$inferInsert> = { updatedAt: new Date() }
    let activityType = 'edited'
    let activityMessage: string | null = null

    switch (action) {
      case 'start': {
        if (!isAssignee) throw new Error('Only the assignee can start this task.')
        if (task.status !== 'assigned') throw new Error('Only an assigned task can be started.')
        updates.status = 'in_progress'
        activityType = 'started'
        activityMessage = 'Started working'
        break
      }
      case 'complete': {
        const isEa = ['ea', 'eba'].includes(String(actor.role || '').trim().toLowerCase())
        if (!isEa) throw new Error('Only an EA can mark this task as completed.')
        if (!isOpen) throw new Error('Only an open task can be completed.')
        const remark = text(input.completionRemark)
        if (!remark) throw new Error('A completion remark is required.')
        updates.status = 'done'
        updates.completionRemark = remark
        updates.completedBy = actor.id
        updates.completedAt = new Date()
        activityType = 'completed'
        activityMessage = remark
        break
      }
      case 'reopen': {
        if (!isManager) throw new Error('Only the delegator can reopen this task.')
        if (task.status !== 'done') throw new Error('Only a completed task can be reopened.')
        updates.status = 'assigned'
        updates.completedBy = null
        updates.completedAt = null
        updates.reminderSentAt = null // re-arm the due reminder — it is an open task again
        // Keep completionRemark on the record for history; the activity log preserves the full trail.
        activityType = 'reopened'
        activityMessage = nullableText(input.completionRemark) // optional reason for reopening
        break
      }
      case 'cancel': {
        if (!isManager) throw new Error('Only the delegator can cancel this task.')
        if (!isOpen) throw new Error('Only an open task can be cancelled.')
        updates.status = 'cancelled'
        activityType = 'cancelled'
        activityMessage = nullableText(input.completionRemark)
        break
      }
      case 'reassign': {
        if (!isManager) throw new Error('Only the delegator can reassign this task.')
        if (!isOpen) throw new Error('Only an open task can be reassigned.')
        const nextId = text(input.assignedTo)
        if (!nextId) throw new Error('A new assignee is required.')
        const assignee = await resolveActiveUser(tx, nextId)
        assertCanAssign(actor, assignee.brand)
        updates.assignedTo = assignee.id
        updates.assignedName = assignee.fullName
        updates.assignedEmail = assignee.email
        updates.reminderSentAt = null // the new assignee should get their own due reminder
        activityType = 'reassigned'
        activityMessage = `Reassigned to ${assignee.fullName}`
        break
      }
      case 'edit': {
        if (!isManager) throw new Error('Only the delegator can edit this task.')
        if (!isOpen) throw new Error('Only an open task can be edited.')
        if (input.title !== undefined) {
          const t = text(input.title)
          if (!t) throw new Error('Title cannot be empty.')
          updates.title = t
        }
        if (input.description !== undefined) updates.description = nullableText(input.description)
        if (input.dueAt !== undefined) {
          updates.dueAt = input.dueAt ? new Date(input.dueAt) : null
          updates.reminderSentAt = null // rescheduled → re-arm so the reminder fires at the new due date
        }
        if (input.priority !== undefined) {
          const p = text(input.priority)
          if (!(TASK_PRIORITIES as readonly string[]).includes(p)) throw new Error('Invalid priority.')
          updates.priority = p
        }
        activityType = 'edited'
        activityMessage = 'Task details updated'
        break
      }
      default:
        throw new Error('Unknown action.')
    }

    const [updated] = await tx.update(delegationTasks).set(updates).where(eq(delegationTasks.id, id)).returning()
    await addActivity(tx, id, activityType, activityMessage, actor)
    return updated
  })
}

// ── Reminder sweep support (consumed by lib/delegation/emails.ts) ─────────────────────────────────
export type DueTask = {
  id: string
  title: string
  dueAt: string
  priority: string
  assignedName: string | null
  assignedEmail: string | null
}

/** Open tasks now due (or overdue) that have not been reminded yet. `lte` on a nullable due_at also
 *  excludes tasks with no due date, so a task without a deadline never triggers a reminder. */
export async function getDueDelegationTasks(): Promise<DueTask[]> {
  const rows = await db
    .select({
      id: delegationTasks.id,
      title: delegationTasks.title,
      dueAt: delegationTasks.dueAt,
      priority: delegationTasks.priority,
      assignedName: delegationTasks.assignedName,
      assignedEmail: delegationTasks.assignedEmail,
    })
    .from(delegationTasks)
    .where(and(
      inArray(delegationTasks.status, ['assigned', 'in_progress']),
      isNull(delegationTasks.reminderSentAt),
      lte(delegationTasks.dueAt, new Date()),
    ))
    .orderBy(delegationTasks.dueAt)
    .limit(500)
  return rows.map((r) => ({ ...r, dueAt: (r.dueAt as Date).toISOString() }))
}

export async function markDelegationRemindersSent(ids: string[]) {
  if (!ids.length) return
  await db.update(delegationTasks).set({ reminderSentAt: new Date() }).where(inArray(delegationTasks.id, ids))
}

// ── EA notification target ────────────────────────────────────────────────────────────────────────
/**
 * EAs who should be CC'd when a task is assigned in a given brand: every active EA whose brand covers
 * the task's brand OR is shared 'all' (user decision). For a KIA task that is the 'all'-tagged EAs
 * (there is no brand='kia' EA in the data); for Hyundai it's the Hyundai EA plus the 'all' EAs.
 */
export async function getBrandEaEmails(taskBrand: string | null): Promise<string[]> {
  const eas = await db
    .select({ email: users.email, brand: users.brand })
    .from(users)
    .where(and(eq(users.role, 'ea'), eq(users.isActive, true), isNull(users.deletedAt)))
  const brand = String(taskBrand || '').trim().toLowerCase()
  return eas
    .filter((e) => {
      const b = parseBrands(e.brand)
      return b.includes('all') || (brand ? b.includes(brand) : false)
    })
    .map((e) => String(e.email || '').trim())
    .filter(Boolean)
}

// ── Per-branch rollup (group-wide viewers only) ────────────────────────────────────────────────────
export type BrandRollupRow = {
  brand: string
  assigned: number
  in_progress: number
  done: number
  cancelled: number
  overdue: number
  total: number
}

/** Cross-branch summary for a group MD: status counts + overdue per brand. Caller must be group-wide. */
export async function getDelegationBrandRollup(): Promise<BrandRollupRow[]> {
  const rows = await db.execute(sql`
    SELECT coalesce(nullif(trim(brand), ''), 'unbranded') AS brand,
      count(*) FILTER (WHERE status = 'assigned')::int AS assigned,
      count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
      count(*) FILTER (WHERE status = 'done')::int AS done,
      count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
      count(*) FILTER (WHERE status IN ('assigned','in_progress') AND due_at IS NOT NULL AND due_at < now())::int AS overdue,
      count(*)::int AS total
    FROM delegation_tasks
    GROUP BY 1
    ORDER BY total DESC`)
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[]
  return list.map((r) => ({
    brand: String(r.brand),
    assigned: Number(r.assigned) || 0,
    in_progress: Number(r.in_progress) || 0,
    done: Number(r.done) || 0,
    cancelled: Number(r.cancelled) || 0,
    overdue: Number(r.overdue) || 0,
    total: Number(r.total) || 0,
  }))
}
