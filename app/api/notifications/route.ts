import { NextRequest, NextResponse } from 'next/server'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { serializeAppDate } from '@/lib/date-time'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import type { AppNotification } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

type NotificationApiRow = Omit<typeof notifications.$inferSelect, 'createdAt' | 'readAt'> & {
  createdAt: string
  readAt: string | null
}

function serializeNotification(notification: NotificationApiRow): AppNotification {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    type: notification.type as AppNotification['type'],
    actionUrl: notification.actionUrl,
    purchaseOrderId: notification.purchaseOrderId,
    entityType: notification.entityType,
    entityId: notification.entityId,
    referenceNumber: notification.referenceNumber,
    workflowStage: notification.workflowStage,
    targetRole: notification.targetRole,
    isRead: notification.isRead,
    createdAt: serializeAppDate(notification.createdAt) || new Date().toISOString(),
    readAt: serializeAppDate(notification.readAt),
    metadata: (notification.metadata as Record<string, unknown> | null) || {},
  }
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 20), 1), 50)

    const [rows, unreadRows] = await Promise.all([
      db
        .select({
          id: notifications.id,
          title: notifications.title,
          message: notifications.message,
          type: notifications.type,
          actionUrl: notifications.actionUrl,
          purchaseOrderId: notifications.purchaseOrderId,
          entityType: notifications.entityType,
          entityId: notifications.entityId,
          referenceNumber: notifications.referenceNumber,
          workflowStage: notifications.workflowStage,
          targetRole: notifications.targetRole,
          dedupeKey: notifications.dedupeKey,
          metadata: notifications.metadata,
          isRead: notifications.isRead,
          userId: notifications.userId,
          createdAt: sql<string>`${notifications.createdAt}::text`,
          readAt: sql<string | null>`${notifications.readAt}::text`,
        })
        .from(notifications)
        .where(eq(notifications.userId, appUser.id))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      db
        .select({ count: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, appUser.id), eq(notifications.isRead, false))),
    ])

    return NextResponse.json({
      notifications: rows.map(serializeNotification),
      unreadCount: unreadRows[0]?.count ?? 0,
    })
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const notificationId = typeof body.notificationId === 'string' ? body.notificationId : null
    const markAll = body.markAll === true

    if (!notificationId && !markAll) {
      return NextResponse.json({ error: 'notificationId or markAll is required' }, { status: 400 })
    }

    const filters = [eq(notifications.userId, appUser.id)]

    if (notificationId) {
      filters.push(eq(notifications.id, notificationId))
    }

    await db
      .update(notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(and(...filters))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating notifications:', error)
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 })
  }
}
