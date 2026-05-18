import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications, purchaseOrders, users, workflowHistory } from '@/lib/db/schema'

type PurchaseOrderRecord = typeof purchaseOrders.$inferSelect
type UserRecord = typeof users.$inferSelect
type WorkflowHistoryRecord = typeof workflowHistory.$inferSelect
type UserRole = UserRecord['role']

type WorkflowNotificationEvent =
  | 'initial_submission_submitted'
  | 'vendor_information_submitted'
  | 'ea_approved'
  | 'ea_denied'
  | 'ea_held'
  | 'md_approved'
  | 'md_denied'
  | 'md_held'
  | 'grn_submitted'

interface NotificationActor {
  id: string
  role: string
  brand?: string | null
  fullName?: string | null
  email?: string | null
}

interface CreateWorkflowNotificationsParams {
  event: WorkflowNotificationEvent
  order: PurchaseOrderRecord
  actor: NotificationActor
  historyEntry: Pick<WorkflowHistoryRecord, 'id' | 'remarks'>
}

interface NotificationRecipient {
  id: string
  role: UserRole
}

const STAGE_LABELS: Record<string, string> = {
  initial_submission: 'Initial Submission',
  vendor_information: 'Vendor Information',
  ea_approval: 'EA Approval',
  md_approval: 'MD Approval',
  grn: 'GRN',
  accounts: 'Accounts',
}

function getActorName(actor: NotificationActor) {
  return actor.fullName || actor.email || 'A team member'
}

function getStageLabel(stage: string | null | undefined) {
  if (!stage) return 'Workflow Update'

  return STAGE_LABELS[stage] || stage.replace(/_/g, ' ')
}

async function getActiveUsersByRole(role: UserRole, branch?: string | null) {
  const filters = [
    eq(users.role, role),
    eq(users.isActive, true),
    isNull(users.deletedAt),
  ]

  if (branch) {
    filters.push(eq(users.brand, branch))
  }

  return db
    .select({
      id: users.id,
      role: users.role,
    })
    .from(users)
    .where(and(...filters))
}

async function getUserById(userId: string | null | undefined) {
  if (!userId) {
    return null
  }

  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1)

  return user || null
}

async function addAssignedRecipientForRoles(
  recipients: NotificationRecipient[],
  order: PurchaseOrderRecord,
  roles: UserRole[]
) {
  const assignedUser = await getUserById(order.assignedTo)

  if (!assignedUser || !roles.includes(assignedUser.role)) {
    return recipients
  }

  return dedupeRecipients([...recipients, assignedUser])
}

async function getRelevantPurchaseManagers(order: PurchaseOrderRecord) {
  const assignedUser = await getUserById(order.assignedTo)

  if (assignedUser?.role === 'purchase_manager') {
    return [assignedUser]
  }

  const [historyUser] = await db
    .select({
      performedBy: workflowHistory.performedBy,
    })
    .from(workflowHistory)
    .where(and(
      eq(workflowHistory.purchaseOrderId, order.id),
      eq(workflowHistory.userRole, 'purchase_manager')
    ))
    .orderBy(asc(workflowHistory.createdAt))
    .limit(1)

  if (historyUser?.performedBy) {
    const user = await getUserById(historyUser.performedBy)

    if (user) {
      return [user]
    }
  }

  return getActiveUsersByRole('purchase_manager')
}

function dedupeRecipients(recipients: NotificationRecipient[]) {
  return Array.from(new Map(recipients.map((recipient) => [recipient.id, recipient])).values())
}

async function resolveRecipients(event: WorkflowNotificationEvent, order: PurchaseOrderRecord) {
  switch (event) {
    case 'initial_submission_submitted':
      return addAssignedRecipientForRoles(await getActiveUsersByRole('ea', order.brand), order, ['ea'])
    case 'vendor_information_submitted':
      return addAssignedRecipientForRoles(await getActiveUsersByRole('ea', order.brand), order, ['ea'])
    case 'ea_approved':
      return addAssignedRecipientForRoles(await getActiveUsersByRole('md', order.brand), order, ['md'])
    case 'md_approved':
      return getRelevantPurchaseManagers(order)
    case 'grn_submitted':
      return addAssignedRecipientForRoles(await getActiveUsersByRole('accounts'), order, ['accounts'])
    case 'ea_held': {
      const [admins, purchaseManagers, originalSubmitter] = await Promise.all([
        getActiveUsersByRole('admin'),
        getRelevantPurchaseManagers(order),
        getUserById(order.createdBy),
      ])

      return dedupeRecipients([
        ...admins,
        ...purchaseManagers,
        ...(originalSubmitter ? [originalSubmitter] : []),
      ])
    }
    case 'md_denied':
    case 'md_held': {
      const [admins, branchEaUsers, purchaseManagers, originalSubmitter] = await Promise.all([
        getActiveUsersByRole('admin'),
        getActiveUsersByRole('ea', order.brand),
        getRelevantPurchaseManagers(order),
        getUserById(order.createdBy),
      ])

      return dedupeRecipients([
        ...admins,
        ...branchEaUsers,
        ...purchaseManagers,
        ...(originalSubmitter ? [originalSubmitter] : []),
      ])
    }
    case 'ea_denied': {
      const [admins, purchaseManagers, originalSubmitter] = await Promise.all([
        getActiveUsersByRole('admin'),
        getRelevantPurchaseManagers(order),
        getUserById(order.createdBy),
      ])

      return dedupeRecipients([
        ...admins,
        ...purchaseManagers,
        ...(originalSubmitter ? [originalSubmitter] : []),
      ])
    }
    default:
      return []
  }
}

function buildNotificationContent(
  event: WorkflowNotificationEvent,
  order: PurchaseOrderRecord,
  actor: NotificationActor,
  remarks: string | null | undefined
) {
  const referenceNumber = order.orderNumber
  const actorName = getActorName(actor)
  const denialRemarks = remarks?.trim() || 'No remarks provided.'
  const holdRemarks = remarks?.trim() || 'No remarks provided.'

  switch (event) {
    case 'initial_submission_submitted':
      return {
        title: 'Purchase order awaiting EA approval',
        message: `${referenceNumber} was submitted by ${actorName} and now needs EA approval.`,
        type: 'info' as const,
        workflowStage: 'ea_approval',
      }
    case 'vendor_information_submitted':
      return {
        title: 'Vendor information updated',
        message: `${referenceNumber} vendor details were updated by ${actorName}.`,
        type: 'info' as const,
        workflowStage: order.currentStage,
      }
    case 'ea_approved':
      return {
        title: 'Purchase order awaiting MD approval',
        message: `${referenceNumber} was approved by EA. Final approval is now required.`,
        type: 'info' as const,
        workflowStage: 'md_approval',
      }
    case 'ea_denied':
      return {
        title: 'Purchase order denied at EA approval',
        message: `EA denied ${referenceNumber}. Remarks: ${denialRemarks}`,
        type: 'error' as const,
        workflowStage: 'initial_submission',
      }
    case 'ea_held':
      return {
        title: 'Purchase order placed on hold by EA',
        message: `EA placed ${referenceNumber} on hold. Remarks: ${holdRemarks}`,
        type: 'warning' as const,
        workflowStage: 'ea_approval',
      }
    case 'md_approved':
      return {
        title: 'MD approved the purchase order',
        message: `${referenceNumber} was approved by MD. GRN processing can begin now.`,
        type: 'success' as const,
        workflowStage: 'grn',
      }
    case 'md_denied':
      return {
        title: 'Purchase order denied at MD approval',
        message: `MD denied ${referenceNumber}. Remarks: ${denialRemarks}`,
        type: 'error' as const,
        workflowStage: 'ea_approval',
      }
    case 'md_held':
      return {
        title: 'Purchase order placed on hold by MD',
        message: `MD placed ${referenceNumber} on hold. Remarks: ${holdRemarks}`,
        type: 'warning' as const,
        workflowStage: 'ea_approval',
      }
    case 'grn_submitted':
      return {
        title: 'Purchase order awaiting accounts processing',
        message: `${referenceNumber} GRN details were submitted by ${actorName}. Accounts review is now pending.`,
        type: 'warning' as const,
        workflowStage: 'accounts',
      }
    default:
      return {
        title: 'Purchase order updated',
        message: `${referenceNumber} moved to ${getStageLabel(order.currentStage)}.`,
        type: 'info' as const,
        workflowStage: order.currentStage,
      }
  }
}

export async function createPurchaseOrderWorkflowNotifications({
  event,
  order,
  actor,
  historyEntry,
}: CreateWorkflowNotificationsParams) {
  const recipients = await resolveRecipients(event, order)
  const filteredRecipients = recipients.filter((recipient) => recipient.id !== actor.id)

  if (filteredRecipients.length === 0) {
    return
  }

  const content = buildNotificationContent(event, order, actor, historyEntry.remarks)
  const actionUrl = `/purchase-orders?orderId=${order.id}`
  const createdAt = new Date()
  const payload = filteredRecipients.map((recipient) => ({
    userId: recipient.id,
    title: content.title,
    message: content.message,
    type: content.type,
    actionUrl,
    purchaseOrderId: order.id,
    referenceNumber: order.orderNumber,
    workflowStage: content.workflowStage,
    targetRole: recipient.role as UserRecord['role'],
    dedupeKey: historyEntry.id,
    createdAt,
    metadata: {
      event,
      historyId: historyEntry.id,
      actorId: actor.id,
      actorRole: actor.role,
      actorName: getActorName(actor),
      remarks: historyEntry.remarks,
      orderStatus: order.status,
      stageLabel: getStageLabel(content.workflowStage),
    },
  }))

  await db
    .insert(notifications)
    .values(payload)
    .onConflictDoNothing({
      target: [notifications.userId, notifications.dedupeKey],
    })
}
