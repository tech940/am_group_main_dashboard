export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export interface AppNotification {
  id: string
  title: string
  message: string
  type: NotificationLevel
  actionUrl: string | null
  purchaseOrderId: string | null
  entityType: string | null
  entityId: string | null
  referenceNumber: string | null
  workflowStage: string | null
  targetRole: string | null
  isRead: boolean
  createdAt: string
  readAt: string | null
  metadata: Record<string, unknown>
}
