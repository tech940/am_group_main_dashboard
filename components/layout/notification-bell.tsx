'use client'

interface NotificationBellProps {
  userId: string | null
  userRole?: string | null
}

export function NotificationBell({ userId, userRole }: NotificationBellProps) {
  // Notification functionality disabled for now.
  // We will restore it later from notification-bell.tsx.bak.
  return null
}
