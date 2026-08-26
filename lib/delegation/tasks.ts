import { and, desc, eq, ilike, inArray, isNull, lte, or, sql, aliasedTable } from 'drizzle-orm'
import { db } from '@/lib/db'
import { delegationTaskActivity, delegationTasks, users, delegationContacts } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { canDelegateTasks, concreteBrands, isAssignableUnderBrands, isGroupWideDelegation, parseBrands, resolveTaskBrand } from '@/lib/delegation/access'

// ── Validation vocabularies (text columns, checked here rather than as a pgEnum) ──────────────────
export const TASK_STATUSES = ['assigned', 'done', 'cancelled'] as const
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
  title?: string | null
  description?: string | null
  assignedTo: string
  dueAt?: string | null
  priority?: string | null
  brand?: string | null
  dealerCode?: string | null
  mdUserId?: string | null
  isExternal?: boolean
  externalContactName?: string | null
  externalContactEmail?: string | null
  externalContactPhone?: string | null
}

export type TaskAction = 'complete' | 'reopen' | 'cancel' | 'reassign' | 'edit' | 'comment' | 'remind' | 'md_remark'
export type UpdateTaskInput = {
  completionRemark?: string | null
  assignedTo?: string | null
  title?: string | null
  description?: string | null
  dueAt?: string | null
  followUpAt?: string | null
  priority?: string | null
  mdUserId?: string | null
  isExternal?: boolean
  externalContactName?: string | null
  externalContactEmail?: string | null
  externalContactPhone?: string | null
  remark?: string | null
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
/**
 * The row-visibility predicate:
 *  - GROUP-WIDE (brand 'all' / developer / admin) → all tasks, every brand.
 *  - STRICT USER/BRANCH EA SCOPING → MD/EA sees tasks created by or assigned to themselves OR their branch EA/MD.
 *  - Fail closed: an unidentifiable viewer sees nothing.
 */
export async function getScopeFilter(viewer: Viewer) {
  if (isGroupWideDelegation(viewer)) return undefined
  if (!viewer.id) return sql`false`

  const role = String(viewer.role || '').trim().toLowerCase()
  const own = or(eq(delegationTasks.createdBy, viewer.id), eq(delegationTasks.assignedTo, viewer.id))

  if (role === 'md') {
    return or(
      eq(delegationTasks.mdUserId, viewer.id),
      own,
      and(isNull(delegationTasks.mdUserId), eq(delegationTasks.createdBy, viewer.id))
    )
  }

  if (role === 'ea' || role === 'eba') {
    const mdUsersInBrand = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.isActive, true),
        isNull(users.deletedAt),
        or(eq(users.role, 'md'), eq(users.role, 'ceo'))
      ))

    const mdIds = mdUsersInBrand.map((u) => u.id)
    if (mdIds.length > 0) {
      return or(
        own,
        inArray(delegationTasks.mdUserId, mdIds),
        and(isNull(delegationTasks.mdUserId), inArray(delegationTasks.createdBy, mdIds))
      )
    }
    return own
  }

  return own
}

function decorate(row: typeof delegationTasks.$inferSelect & { assignedPhone?: string | null; mdUserName?: string | null }, viewer: Viewer) {
  const isCreator = row.createdBy === viewer.id
  const isAssignee = row.assignedTo === viewer.id
  const canManage = isCreator || isGroupWideDelegation(viewer)
  const isOverdue = Boolean(
    row.dueAt && row.status === 'assigned' && new Date(row.dueAt) < new Date(),
  )
  const isEa = ['ea', 'eba', 'admin', 'developer'].includes(String(viewer.role || '').trim().toLowerCase())
  return { ...row, mdUserName: row.mdUserName || null, viewerIsCreator: isCreator, viewerIsAssignee: isAssignee, viewerCanManage: canManage, viewerIsEa: isEa, isOverdue }
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────
export async function listDelegationTasks(input: TaskListInput, viewer: Viewer) {
  const filters = [] as (ReturnType<typeof eq> | ReturnType<typeof or> | ReturnType<typeof sql>)[]
  const scope = await getScopeFilter(viewer)
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

  const mdUsersTable = aliasedTable(users, 'md_users')

  const rows = await db
    .select({
      id: delegationTasks.id,
      title: delegationTasks.title,
      description: delegationTasks.description,
      assignedTo: delegationTasks.assignedTo,
      externalContactId: delegationTasks.externalContactId,
      assignedName: delegationTasks.assignedName,
      assignedEmail: delegationTasks.assignedEmail,
      dueAt: delegationTasks.dueAt,
      followUpAt: delegationTasks.followUpAt,
      status: delegationTasks.status,
      priority: delegationTasks.priority,
      brand: delegationTasks.brand,
      dealerCode: delegationTasks.dealerCode,
      completionRemark: delegationTasks.completionRemark,
      completedBy: delegationTasks.completedBy,
      completedAt: delegationTasks.completedAt,
      reminderSentAt: delegationTasks.reminderSentAt,
      mdUserId: delegationTasks.mdUserId,
      mdUserName: mdUsersTable.fullName,
      createdBy: delegationTasks.createdBy,
      metadata: delegationTasks.metadata,
      createdAt: delegationTasks.createdAt,
      updatedAt: delegationTasks.updatedAt,
      assignedPhone: sql<string | null>`COALESCE(${users.phoneNumber}, ${delegationContacts.phone})`,
    })
    .from(delegationTasks)
    .leftJoin(users, eq(delegationTasks.assignedTo, users.id))
    .leftJoin(delegationContacts, eq(delegationTasks.externalContactId, delegationContacts.id))
    .leftJoin(mdUsersTable, eq(delegationTasks.mdUserId, mdUsersTable.id))
    .where(filters.length ? and(...filters) : undefined)
    // Always newest tasks on top
    .orderBy(
      desc(delegationTasks.createdAt),
    )
    .limit(2000)

  return rows.map((r) => decorate(r, viewer))
}

export async function getDelegationTaskDetail(id: string, viewer: Viewer) {
  const scope = await getScopeFilter(viewer)
  const mdUsersTable = aliasedTable(users, 'md_users')

  const [row] = await db
    .select({
      id: delegationTasks.id,
      title: delegationTasks.title,
      description: delegationTasks.description,
      assignedTo: delegationTasks.assignedTo,
      externalContactId: delegationTasks.externalContactId,
      assignedName: delegationTasks.assignedName,
      assignedEmail: delegationTasks.assignedEmail,
      dueAt: delegationTasks.dueAt,
      followUpAt: delegationTasks.followUpAt,
      status: delegationTasks.status,
      priority: delegationTasks.priority,
      brand: delegationTasks.brand,
      dealerCode: delegationTasks.dealerCode,
      completionRemark: delegationTasks.completionRemark,
      completedBy: delegationTasks.completedBy,
      completedAt: delegationTasks.completedAt,
      reminderSentAt: delegationTasks.reminderSentAt,
      mdUserId: delegationTasks.mdUserId,
      mdUserName: mdUsersTable.fullName,
      createdBy: delegationTasks.createdBy,
      metadata: delegationTasks.metadata,
      createdAt: delegationTasks.createdAt,
      updatedAt: delegationTasks.updatedAt,
      assignedPhone: sql<string | null>`COALESCE(${users.phoneNumber}, ${delegationContacts.phone})`,
    })
    .from(delegationTasks)
    .leftJoin(users, eq(delegationTasks.assignedTo, users.id))
    .leftJoin(delegationContacts, eq(delegationTasks.externalContactId, delegationContacts.id))
    .leftJoin(mdUsersTable, eq(delegationTasks.mdUserId, mdUsersTable.id))
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
  const assignedTo = text(input.assignedTo)
  if (!assignedTo) throw new Error('An assignee is required.')

  const descVal = nullableText(input.description)
  // If title is not provided, generate from description
  const title = text(input.title) || (descVal ? descVal.split('\n')[0].substring(0, 50) : 'Untitled Task')
  if (!title) throw new Error('A task description or title is required.')

  const priority = text(input.priority) || 'high'
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) throw new Error('Invalid priority.')

  return db.transaction(async (tx) => {
    let finalAssignedTo: string | null = null
    let finalExternalContactId: string | null = null
    let finalAssignedName = ''
    let finalAssignedEmail: string | null = null
    let finalAssignedBrand: string | null = null

    // Determine if it is external
    const isOther = assignedTo === 'other'
    const isExternal = Boolean(input.isExternal)

    if (isOther || isExternal) {
      // 1. Manually entering or selecting external contact
      let extName = text(input.externalContactName)
      let extEmail = nullableText(input.externalContactEmail)
      let extPhone = text(input.externalContactPhone)

      if (isOther) {
        if (!extName) throw new Error('External contact name is required.')
        if (!extPhone) throw new Error('External contact phone number is mandatory.')
      }

      // Check if this contact matches an existing dashboard user to prevent duplicates
      let existingUser: any = null
      if (extPhone || extEmail) {
        const filters = []
        if (extPhone) filters.push(eq(users.phoneNumber, extPhone))
        if (extEmail) filters.push(eq(users.email, extEmail))
        
        const [u] = await tx
          .select({ id: users.id, fullName: users.fullName, email: users.email, brand: users.brand, phoneNumber: users.phoneNumber })
          .from(users)
          .where(and(or(...filters), eq(users.isActive, true), isNull(users.deletedAt)))
          .limit(1)
        existingUser = u
      }

      if (existingUser) {
        // Resolve to existing dashboard user!
        finalAssignedTo = existingUser.id
        finalExternalContactId = null
        finalAssignedName = existingUser.fullName
        finalAssignedEmail = extEmail || existingUser.email
        finalAssignedBrand = existingUser.brand

        // Sync entered details back to users table
        const updatesToMake: Record<string, any> = {}
        if (extPhone && extPhone !== existingUser.phoneNumber) {
          updatesToMake.phoneNumber = extPhone
        }
        if (extEmail && extEmail !== existingUser.email) {
          updatesToMake.email = extEmail
        }
        if (Object.keys(updatesToMake).length > 0) {
          await tx
            .update(users)
            .set(updatesToMake)
            .where(eq(users.id, existingUser.id))
        }
      } else {
        // Check if an external contact with the same phone or email exists
        let existingContact: any = null
        if (extPhone || extEmail) {
          const filters = []
          if (extPhone) filters.push(eq(delegationContacts.phone, extPhone))
          if (extEmail) filters.push(eq(delegationContacts.email, extEmail))
          
          const [c] = await tx
            .select()
            .from(delegationContacts)
            .where(or(...filters))
            .limit(1)
          existingContact = c
        }

        if (existingContact) {
          // Resolve to existing external contact!
          finalAssignedTo = null
          finalExternalContactId = existingContact.id
          finalAssignedName = existingContact.name
          finalAssignedEmail = extEmail || existingContact.email

          // Sync entered details back to contacts table
          const updatesToMake: Record<string, any> = {}
          if (extPhone && extPhone !== existingContact.phone) {
            updatesToMake.phone = extPhone
          }
          if (extEmail && extEmail !== existingContact.email) {
            updatesToMake.email = extEmail
          }
          if (Object.keys(updatesToMake).length > 0) {
            await tx
              .update(delegationContacts)
              .set(updatesToMake)
              .where(eq(delegationContacts.id, existingContact.id))
          }
        } else if (isOther) {
          // Create new external contact record!
          const [newContact] = await tx
            .insert(delegationContacts)
            .values({
              name: extName,
              email: extEmail,
              phone: extPhone,
            })
            .returning()
          
          finalAssignedTo = null
          finalExternalContactId = newContact.id
          finalAssignedName = newContact.name
          finalAssignedEmail = newContact.email
        } else {
          // It was selected from picker but not found in user or contact databases
          // Find contact by id
          const [contact] = await tx
            .select()
            .from(delegationContacts)
            .where(eq(delegationContacts.id, assignedTo))
            .limit(1)
          if (!contact) throw new Error('External contact not found.')
          
          finalAssignedTo = null
          finalExternalContactId = contact.id
          finalAssignedName = contact.name
          finalAssignedEmail = contact.email
        }
        finalAssignedBrand = 'all'
      }
    } else {
      // 2. Dashboard user selection
      const assignee = await resolveActiveUser(tx, assignedTo)
      assertCanAssign(actor, assignee.brand)
      finalAssignedTo = assignee.id
      finalExternalContactId = null
      finalAssignedName = assignee.fullName
      finalAssignedEmail = assignee.email
      finalAssignedBrand = assignee.brand
    }

    const taskBrand = resolveTaskBrand(actor.brand, finalAssignedBrand)
    const dueAtDate = input.dueAt ? new Date(input.dueAt) : null

    const [task] = await tx
      .insert(delegationTasks)
      .values({
        title,
        description: descVal,
        assignedTo: finalAssignedTo,
        externalContactId: finalExternalContactId,
        assignedName: finalAssignedName,
        assignedEmail: finalAssignedEmail,
        dueAt: dueAtDate,
        followUpAt: dueAtDate, // Default follow-up date to due date!
        status: 'assigned',
        priority,
        brand: taskBrand,
        dealerCode: nullableText(input.dealerCode),
        mdUserId: nullableText(input.mdUserId) || (actor.role === 'md' ? actor.id : null),
        createdBy: actor.id,
      })
      .returning()

    await addActivity(tx, task.id, 'assigned', `Assigned to ${finalAssignedName}`, actor)
    return task
  })
}

export async function updateDelegationTask(id: string, action: TaskAction, input: UpdateTaskInput, actor: AppUser) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(delegationTasks).where(eq(delegationTasks.id, id)).limit(1)
    if (!task) throw new Error('Task not found.')

    const isAssignee = task.assignedTo === actor.id
    const isManager = task.createdBy === actor.id || isGroupWideDelegation(actor)
    const isOpen = task.status === 'assigned'

    const updates: Partial<typeof delegationTasks.$inferInsert> = { updatedAt: new Date() }
    let activityType = 'edited'
    let activityMessage: string | null = null

    switch (action) {
      case 'complete': {
        const isEa = ['ea', 'eba', 'admin', 'developer'].includes(String(actor.role || '').trim().toLowerCase())
        if (!isEa) throw new Error('Only an EA can mark this task as completed.')
        if (!isOpen) throw new Error('Only an open task can be completed.')
        const remark = nullableText(input.completionRemark)
        updates.status = 'done'
        updates.completionRemark = remark
        updates.completedBy = actor.id
        updates.completedAt = new Date()
        activityType = 'completed'
        activityMessage = remark || 'Task completed'
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
        const isExternal = Boolean(input.isExternal)
        const extName = text(input.externalContactName)
        const extEmail = nullableText(input.externalContactEmail)
        const extPhone = text(input.externalContactPhone)
        const isOther = nextId === 'other' || (isExternal && Boolean(extName || extPhone))

        if (nextId && (nextId !== task.assignedTo && nextId !== task.externalContactId || isOther)) {
          if (isOther || isExternal) {
            if (isOther && (!extName || !extPhone)) {
              throw new Error('Name and Phone Number are required for external contacts.')
            }

            let existingContact = null
            if (extPhone) {
              const [c] = await tx.select().from(delegationContacts).where(eq(delegationContacts.phone, extPhone)).limit(1)
              existingContact = c
            }
            if (!existingContact && extName) {
              const [c] = await tx.select().from(delegationContacts).where(eq(delegationContacts.name, extName)).limit(1)
              existingContact = c
            }

            if (existingContact) {
              updates.assignedTo = null
              updates.externalContactId = existingContact.id
              updates.assignedName = existingContact.name
              updates.assignedEmail = extEmail || existingContact.email
            } else if (extName && extPhone) {
              const [newContact] = await tx
                .insert(delegationContacts)
                .values({
                  name: extName,
                  email: extEmail,
                  phone: extPhone,
                })
                .returning()
              updates.assignedTo = null
              updates.externalContactId = newContact.id
              updates.assignedName = newContact.name
              updates.assignedEmail = newContact.email
            } else if (nextId && nextId !== 'other') {
              const [contact] = await tx.select().from(delegationContacts).where(eq(delegationContacts.id, nextId)).limit(1)
              if (!contact) throw new Error('External contact not found.')
              updates.assignedTo = null
              updates.externalContactId = contact.id
              updates.assignedName = contact.name
              updates.assignedEmail = contact.email
            }
          } else {
            const [userRecord] = await tx.select().from(users).where(eq(users.id, nextId)).limit(1)
            if (userRecord) {
              assertCanAssign(actor, userRecord.brand)
              updates.assignedTo = userRecord.id
              updates.externalContactId = null
              updates.assignedName = userRecord.fullName
              updates.assignedEmail = userRecord.email
            } else {
              const [contact] = await tx.select().from(delegationContacts).where(eq(delegationContacts.id, nextId)).limit(1)
              if (!contact) throw new Error('Assignee not found.')
              updates.assignedTo = null
              updates.externalContactId = contact.id
              updates.assignedName = contact.name
              updates.assignedEmail = contact.email
            }
          }
        }
        
        if (input.dueAt !== undefined) {
          updates.dueAt = input.dueAt ? new Date(input.dueAt) : null
        }
        if (input.followUpAt !== undefined) {
          updates.followUpAt = input.followUpAt ? new Date(input.followUpAt) : null
        }
        
        updates.reminderSentAt = null // reschedule -> re-arm due reminder
        activityType = 'reassigned'
        const remarkText = text(input.remark)
        activityMessage = remarkText ? `Rescheduled: ${remarkText}` : `Rescheduled due date/follow-up date`
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
        if (input.mdUserId !== undefined) {
          updates.mdUserId = nullableText(input.mdUserId)
        }
        activityType = 'edited'
        activityMessage = 'Task details updated'
        break
      }
      case 'comment': {
        const comment = text(input.completionRemark)
        if (!comment) throw new Error('Note content is required.')
        activityType = 'commented'
        activityMessage = comment
        break
      }
      case 'remind': {
        activityType = 'reminded'
        activityMessage = 'Sent task reminder email'
        break
      }
      case 'md_remark': {
        const mdRemarkText = text(input.remark || input.completionRemark)
        if (!mdRemarkText) throw new Error('MD Remark content is required.')
        const existingMeta = (task.metadata as Record<string, unknown>) || {}
        updates.metadata = {
          ...existingMeta,
          mdRemark: mdRemarkText,
          mdRemarkBy: actor.id,
          mdRemarkByName: actor.fullName,
          mdRemarkByRole: actor.role,
          mdRemarkAt: new Date().toISOString(),
        }
        activityType = 'md_remark'
        activityMessage = `MD Remark: ${mdRemarkText}`
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
  description?: string | null
  dueAt: string
  priority: string
  status: string
  assignedName: string | null
  assignedEmail: string | null
  mdUserEmail: string | null
}

/** Open pending tasks (assigned or in_progress) that receive daily morning reminders at 9:30 AM until marked done. */
export async function getDueDelegationTasks(): Promise<DueTask[]> {
  const mdUsersTable = aliasedTable(users, 'md_users')
  const rows = await db
    .select({
      id: delegationTasks.id,
      title: delegationTasks.title,
      description: delegationTasks.description,
      dueAt: delegationTasks.dueAt,
      priority: delegationTasks.priority,
      status: delegationTasks.status,
      assignedName: delegationTasks.assignedName,
      assignedEmail: delegationTasks.assignedEmail,
      userEmail: users.email,
      userName: users.fullName,
      mdUserEmail: mdUsersTable.email,
    })
    .from(delegationTasks)
    .leftJoin(users, eq(delegationTasks.assignedTo, users.id))
    .leftJoin(mdUsersTable, eq(delegationTasks.mdUserId, mdUsersTable.id))
    .where(inArray(delegationTasks.status, ['assigned', 'in_progress']))
    .orderBy(delegationTasks.dueAt)
    .limit(1000)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    dueAt: r.dueAt ? (r.dueAt as Date).toISOString() : '',
    priority: r.priority || 'normal',
    status: r.status || 'assigned',
    assignedName: r.assignedName || r.userName || 'Team Member',
    assignedEmail: r.assignedEmail || r.userEmail || null,
    mdUserEmail: r.mdUserEmail || null,
  }))
}

export async function markDelegationRemindersSent(ids: string[]) {
  if (!ids.length) return
  const now = new Date()
  await db.update(delegationTasks).set({ reminderSentAt: now }).where(inArray(delegationTasks.id, ids))

  await db.insert(delegationTaskActivity).values(
    ids.map((taskId) => ({
      taskId,
      type: 'reminded',
      message: 'Sent daily 9:30 AM morning pending task reminder email',
      actorUserId: null,
      actorName: 'System',
      actorRole: 'System',
      createdAt: now,
    }))
  )
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

// ── Delete ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Permanently deletes a delegation task and all of its activity records.
 * Only the task creator or a group-wide delegator (MD/Developer/Admin) may delete.
 *
 * The delegation_task_activity table has an immutability trigger that blocks DELETE by default.
 * We set a session-local flag (app.allow_activity_delete = 'true') that the trigger checks before
 * raising an exception — this avoids the need for superuser/ALTER TABLE privileges.
 */
export async function deleteDelegationTask(id: string, actor: AppUser): Promise<void> {
  // Load the task to verify it exists and check ownership
  const [task] = await db
    .select({ id: delegationTasks.id, createdBy: delegationTasks.createdBy })
    .from(delegationTasks)
    .where(eq(delegationTasks.id, id))
    .limit(1)

  if (!task) throw new Error('Task not found.')

  const isCreator = task.createdBy === actor.id
  const isGroupWide = isGroupWideDelegation(actor)

  if (!isCreator && !isGroupWide) {
    throw new Error('You do not have permission to delete this task. Only the creator or a group-wide manager may delete tasks.')
  }

  await db.transaction(async (tx) => {
    // Signal the immutability trigger to allow this intentional delete
    await tx.execute(sql`SET LOCAL "app.allow_activity_delete" = 'true'`)
    // Remove all activity rows for this task (trigger now allows it)
    await tx.delete(delegationTaskActivity).where(eq(delegationTaskActivity.taskId, id))
    // Delete the task itself (SET LOCAL resets automatically at transaction end)
    await tx.delete(delegationTasks).where(eq(delegationTasks.id, id))
  })
}
