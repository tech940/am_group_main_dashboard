import 'server-only'

import { and, eq, isNull, or } from 'drizzle-orm'
import { ALL_BRANCH_OPTION } from '@/lib/branches'
import { db } from '@/lib/db'
import { notifications, pettyCashExpenses, pettyCashRequests, users } from '@/lib/db/schema'

type UserRecord = typeof users.$inferSelect
type UserRole = UserRecord['role']
type PettyCashRequestRecord = typeof pettyCashRequests.$inferSelect
type PettyCashExpenseRecord = typeof pettyCashExpenses.$inferSelect

type PettyCashNotificationEvent =
  | 'request_submitted'
  | 'request_ea_approved'
  | 'request_md_approved'
  | 'request_approved'
  | 'request_held'
  | 'request_rejected'
  | 'expense_submitted'
  | 'expense_posted'
  | 'expense_ea_approved'
  | 'expense_md_approved'
  | 'expense_approved'
  | 'expense_rejected'

interface PettyCashActor {
  id: string
  role: string
  brand?: string | null
  fullName?: string | null
  email?: string | null
}

interface CreatePettyCashNotificationParams {
  event: PettyCashNotificationEvent
  entity: PettyCashRequestRecord | PettyCashExpenseRecord
  entityType: 'request' | 'expense'
  actor: PettyCashActor
  historyId: string
  remarks?: string | null
}

type NotificationRecipient = Pick<UserRecord, 'id' | 'role'>

function getActorName(actor: PettyCashActor) {
  return actor.fullName || actor.email || 'A team member'
}

function isExpense(entity: PettyCashRequestRecord | PettyCashExpenseRecord): entity is PettyCashExpenseRecord {
  return 'expenseNumber' in entity
}

async function getActiveUsersByRole(role: UserRole, branch?: string | null) {
  const filters = [
    eq(users.role, role),
    eq(users.isActive, true),
    isNull(users.deletedAt),
  ]

  if (branch) {
    filters.push(or(
      eq(users.brand, branch),
      eq(users.brand, ALL_BRANCH_OPTION.value),
      isNull(users.brand)
    )!)
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

function dedupeRecipients(recipients: NotificationRecipient[]) {
  return Array.from(new Map(recipients.map((recipient) => [recipient.id, recipient])).values())
}

async function resolveRecipients(event: PettyCashNotificationEvent, entity: PettyCashRequestRecord | PettyCashExpenseRecord) {
  const branchId = entity.branchId

  switch (event) {
    case 'request_submitted':
    case 'expense_submitted':
    case 'expense_posted':
      return dedupeRecipients([
        ...await getActiveUsersByRole('ea', branchId),
        ...await getActiveUsersByRole('md', branchId),
      ])
    case 'request_ea_approved':
    case 'expense_ea_approved':
      return getActiveUsersByRole('md', branchId)
    case 'request_md_approved':
    case 'expense_md_approved':
      return getActiveUsersByRole('accounts', branchId)
    case 'request_approved':
    case 'request_held':
    case 'request_rejected':
    case 'expense_approved':
    case 'expense_rejected': {
      const creator = await getUserById(entity.createdBy)
      return creator ? [creator] : []
    }
    default:
      return []
  }
}

function buildContent(
  event: PettyCashNotificationEvent,
  entity: PettyCashRequestRecord | PettyCashExpenseRecord,
  actor: PettyCashActor,
  remarks?: string | null,
) {
  const referenceNumber = isExpense(entity) ? entity.expenseNumber : entity.requestNumber
  const actorName = getActorName(actor)
  const amount = isExpense(entity) ? entity.amount : entity.requestedAmount
  const branch = entity.branchId.toUpperCase()
  const remarkText = remarks?.trim() ? ` Remarks: ${remarks.trim()}` : ''

  switch (event) {
    case 'request_submitted':
      return {
        title: 'Petty cash request awaiting EA approval',
        message: `${referenceNumber} for Rs ${amount} was submitted by ${actorName} for ${branch}.`,
        type: 'info' as const,
        workflowStage: 'ea_approval',
      }
    case 'request_ea_approved':
      return {
        title: 'Petty cash request awaiting MD approval',
        message: `${referenceNumber} was approved by EA and now needs MD approval.`,
        type: 'info' as const,
        workflowStage: 'md_approval',
      }
    case 'request_md_approved':
      return {
        title: 'Petty cash allocation awaiting Accounts',
        message: `${referenceNumber} was approved by MD. Accounts must allocate the final amount.`,
        type: 'warning' as const,
        workflowStage: 'accounts',
      }
    case 'request_approved':
      return {
        title: 'Petty cash allocation approved',
        message: `${referenceNumber} has been allocated and is ready for expenses.`,
        type: 'success' as const,
        workflowStage: 'allocated',
      }
    case 'request_held':
      return {
        title: 'Petty cash request placed on hold',
        message: `${referenceNumber} was placed on hold by ${actorName}.${remarkText}`,
        type: 'warning' as const,
        workflowStage: 'on_hold',
      }
    case 'expense_submitted':
      return {
        title: 'Petty cash expense submitted',
        message: `${referenceNumber} for Rs ${amount} was submitted for ${branch}.`,
        type: 'info' as const,
        workflowStage: 'ea_approval',
      }
    case 'expense_posted':
      return {
        title: 'Petty cash expense posted',
        message: `${referenceNumber} for Rs ${amount} was posted by ${actorName} for ${branch} and deducted from the allocation.`,
        type: 'info' as const,
        workflowStage: 'ledger',
      }
    case 'expense_ea_approved':
      return {
        title: 'Petty cash expense awaiting MD approval',
        message: `${referenceNumber} was approved by EA and now needs MD approval.`,
        type: 'info' as const,
        workflowStage: 'md_approval',
      }
    case 'expense_md_approved':
      return {
        title: 'Petty cash expense awaiting Accounts',
        message: `${referenceNumber} was approved by MD. Accounts final approval is pending.`,
        type: 'warning' as const,
        workflowStage: 'accounts',
      }
    case 'expense_approved':
      return {
        title: 'Petty cash expense approved',
        message: `${referenceNumber} has been approved and posted to the ledger.`,
        type: 'success' as const,
        workflowStage: 'ledger',
      }
    case 'request_rejected':
    case 'expense_rejected':
      return {
        title: 'Petty cash item rejected',
        message: `${referenceNumber} was rejected by ${actorName}.${remarkText}`,
        type: 'error' as const,
        workflowStage: 'rejected',
      }
    default:
      return {
        title: 'Petty cash updated',
        message: `${referenceNumber} was updated by ${actorName}.`,
        type: 'info' as const,
        workflowStage: 'workflow',
      }
  }
}

export async function createPettyCashNotifications({
  event,
  entity,
  entityType,
  actor,
  historyId,
  remarks,
}: CreatePettyCashNotificationParams) {
  // Disabled globally: we don't need petty cash notifications at all for anybody.
  return
}
