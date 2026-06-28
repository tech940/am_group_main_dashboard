import 'server-only'

import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { financeOrders, financeOrderWorkflow, notifications, users } from '@/lib/db/schema'
import { ALL_BRANCH_OPTION, USER_BRANCH_OPTIONS } from '@/lib/branches'

type FinanceOrderRecord = typeof financeOrders.$inferSelect
type FinanceWorkflowRecord = typeof financeOrderWorkflow.$inferSelect
type UserRecord = typeof users.$inferSelect
type UserRole = UserRecord['role']

type FinanceWorkflowNotificationEvent =
  | 'finance_order_submitted'
  | 'accounts_verified'
  | 'accounts_denied'
  | 'accounts_held'
  | 'ea_approved'
  | 'ea_denied'
  | 'ea_held'
  | 'md_approved'
  | 'md_denied'
  | 'md_held'

interface NotificationActor {
  id: string
  role: string
  fullName?: string | null
  email?: string | null
}

interface CreateFinanceWorkflowNotificationsParams {
  event: FinanceWorkflowNotificationEvent
  order: FinanceOrderRecord
  actor: NotificationActor
  historyEntry: Pick<FinanceWorkflowRecord, 'id' | 'remarks'>
}

interface NotificationRecipient {
  id: string
  role: UserRole
}

type NotificationLoaders = ReturnType<typeof createNotificationLoaders>

function getActorName(actor: NotificationActor) {
  return actor.fullName || actor.email || 'A team member'
}

function getOrderBranchValue(order: FinanceOrderRecord) {
  const dealer = String(order.dealer || '').trim()
  return USER_BRANCH_OPTIONS.find((branch) => branch.value === dealer || branch.label === dealer)?.value || null
}

async function getActiveUsersByRole(role: UserRole, branch?: string | null) {
  const filters = [eq(users.role, role), eq(users.isActive, true), isNull(users.deletedAt)]
  if (branch && branch !== ALL_BRANCH_OPTION.value) {
    filters.push(or(eq(users.brand, branch), eq(users.brand, ALL_BRANCH_OPTION.value), isNull(users.brand))!)
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
  if (!userId) return null

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

function createNotificationLoaders() {
  const activeUsersByRoleCache = new Map<string, Promise<NotificationRecipient[]>>()
  const userByIdCache = new Map<string, Promise<NotificationRecipient | null>>()

  return {
    getActiveUsersByRole(role: UserRole, branch?: string | null) {
      const key = `${role}:${branch || 'all'}`
      if (!activeUsersByRoleCache.has(key)) {
        activeUsersByRoleCache.set(key, getActiveUsersByRole(role, branch))
      }
      return activeUsersByRoleCache.get(key)!
    },
    getUserById(userId: string | null | undefined) {
      if (!userId) return Promise.resolve(null)
      if (!userByIdCache.has(userId)) {
        userByIdCache.set(userId, getUserById(userId))
      }
      return userByIdCache.get(userId)!
    },
  }
}

async function getRelevantFinanceHeads(order: FinanceOrderRecord, loaders: NotificationLoaders) {
  const creator = await loaders.getUserById(order.createdBy)

  if (creator?.role === 'finance_head') {
    return [creator]
  }

  const [historyUser] = await db
    .select({
      performedBy: financeOrderWorkflow.performedBy,
    })
    .from(financeOrderWorkflow)
    .where(and(
      eq(financeOrderWorkflow.financeOrderId, order.id),
      eq(financeOrderWorkflow.userRole, 'finance_head')
    ))
    .orderBy(asc(financeOrderWorkflow.createdAt))
    .limit(1)

  if (historyUser?.performedBy) {
    const financeHead = await loaders.getUserById(historyUser.performedBy)

    if (financeHead?.role === 'finance_head') {
      return [financeHead]
    }
  }

  return []
}

function dedupeRecipients(recipients: NotificationRecipient[]) {
  return Array.from(new Map(recipients.map((recipient) => [recipient.id, recipient])).values())
}

async function resolveRecipients(event: FinanceWorkflowNotificationEvent, order: FinanceOrderRecord) {
  const branch = getOrderBranchValue(order)
  const loaders = createNotificationLoaders()

  switch (event) {
    case 'finance_order_submitted':
      return loaders.getActiveUsersByRole('accounts', branch)
    case 'accounts_verified':
      return loaders.getActiveUsersByRole('ea', branch)
    case 'accounts_denied':
    case 'accounts_held': {
      const [admins, financeHeads, creator] = await Promise.all([
        loaders.getActiveUsersByRole('admin'),
        getRelevantFinanceHeads(order, loaders),
        loaders.getUserById(order.createdBy),
      ])
      return dedupeRecipients([...admins, ...financeHeads, ...(creator ? [creator] : [])])
    }
    case 'ea_approved':
      return loaders.getActiveUsersByRole('md', branch)
    case 'ea_denied':
    case 'ea_held': {
      const [admins, financeHeads, creator] = await Promise.all([
        loaders.getActiveUsersByRole('admin'),
        getRelevantFinanceHeads(order, loaders),
        loaders.getUserById(order.createdBy),
      ])
      return dedupeRecipients([...admins, ...financeHeads, ...(creator ? [creator] : [])])
    }
    case 'md_denied':
    case 'md_held': {
      const [admins, branchEaUsers, financeHeads, creator] = await Promise.all([
        loaders.getActiveUsersByRole('admin'),
        loaders.getActiveUsersByRole('ea', branch),
        getRelevantFinanceHeads(order, loaders),
        loaders.getUserById(order.createdBy),
      ])
      return dedupeRecipients([...admins, ...branchEaUsers, ...financeHeads, ...(creator ? [creator] : [])])
    }
    case 'md_approved': {
      const [financeHeads, admins, creator] = await Promise.all([
        getRelevantFinanceHeads(order, loaders),
        loaders.getActiveUsersByRole('admin'),
        loaders.getUserById(order.createdBy),
      ])
      return dedupeRecipients([...financeHeads, ...admins, ...(creator ? [creator] : [])])
    }
    default:
      return []
  }
}

function buildNotificationContent(
  event: FinanceWorkflowNotificationEvent,
  order: FinanceOrderRecord,
  actor: NotificationActor,
  remarks: string | null | undefined
) {
  const referenceNumber = order.orderNumber
  const actorName = getActorName(actor)
  const safeRemarks = remarks?.trim() || 'No remarks provided.'

  switch (event) {
    case 'finance_order_submitted':
      return {
        title: 'Finance order awaiting payment verification',
        message: `${referenceNumber} for invoice ${order.invoiceNumber} was submitted by ${actorName}. Accounts must verify payment received.`,
        type: 'info' as const,
        workflowStage: 'accounts_verification',
      }
    case 'accounts_verified':
      return {
        title: 'Finance order awaiting EA approval',
        message: `Accounts verified payment received for ${referenceNumber}. EA approval is now required.`,
        type: 'info' as const,
        workflowStage: 'ea_approval',
      }
    case 'accounts_denied':
      return {
        title: 'Finance order denied by Accounts',
        message: `Accounts denied ${referenceNumber}. Remarks: ${safeRemarks}`,
        type: 'error' as const,
        workflowStage: 'finance_head_submission',
      }
    case 'accounts_held':
      return {
        title: 'Finance order placed on hold by Accounts',
        message: `Accounts placed ${referenceNumber} on hold. Remarks: ${safeRemarks}`,
        type: 'warning' as const,
        workflowStage: 'accounts_verification',
      }
    case 'ea_approved':
      return {
        title: 'Finance order awaiting MD approval',
        message: `${referenceNumber} was approved by EA. MD approval is now required.`,
        type: 'info' as const,
        workflowStage: 'md_approval',
      }
    case 'ea_denied':
      return {
        title: 'Finance order denied by EA',
        message: `EA denied ${referenceNumber}. Remarks: ${safeRemarks}`,
        type: 'error' as const,
        workflowStage: 'finance_head_submission',
      }
    case 'ea_held':
      return {
        title: 'Finance order placed on hold by EA',
        message: `EA placed ${referenceNumber} on hold. Remarks: ${safeRemarks}`,
        type: 'warning' as const,
        workflowStage: 'ea_approval',
      }
    case 'md_approved':
      return {
        title: 'Finance order fully approved',
        message: `${referenceNumber} was approved by MD and is now complete.`,
        type: 'success' as const,
        workflowStage: 'completed',
      }
    case 'md_denied':
      return {
        title: 'Finance order denied by MD',
        message: `MD denied ${referenceNumber}. Remarks: ${safeRemarks}`,
        type: 'error' as const,
        workflowStage: 'finance_head_submission',
      }
    case 'md_held':
      return {
        title: 'Finance order placed on hold by MD',
        message: `MD placed ${referenceNumber} on hold. Remarks: ${safeRemarks}`,
        type: 'warning' as const,
        workflowStage: 'md_approval',
      }
  }
}

export async function createFinanceOrderWorkflowNotifications({
  event,
  order,
  actor,
  historyEntry,
}: CreateFinanceWorkflowNotificationsParams) {
  const recipients = await resolveRecipients(event, order)
  const filteredRecipients = recipients.filter((recipient) => recipient.id !== actor.id)

  if (filteredRecipients.length === 0) return

  const content = buildNotificationContent(event, order, actor, historyEntry.remarks)
  const actionUrl = `/finance-orders?orderId=${order.id}`
  const createdAt = new Date()

  await db
    .insert(notifications)
    .values(filteredRecipients.map((recipient) => ({
      userId: recipient.id,
      title: content.title,
      message: content.message,
      type: content.type,
      actionUrl,
      purchaseOrderId: null,
      referenceNumber: order.orderNumber,
      workflowStage: content.workflowStage,
      targetRole: recipient.role,
      dedupeKey: historyEntry.id,
      createdAt,
      metadata: {
        module: 'finance_orders',
        event,
        financeOrderId: order.id,
        historyId: historyEntry.id,
        actorId: actor.id,
        actorRole: actor.role,
        actorName: getActorName(actor),
        remarks: historyEntry.remarks,
        orderStatus: order.status,
      },
    })))
    .onConflictDoNothing({
      target: [notifications.userId, notifications.dedupeKey],
    })
}
