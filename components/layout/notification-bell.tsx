'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellRing, CheckCheck, ExternalLink, Loader2, ShieldAlert, Volume2 } from 'lucide-react'
import { useTopLoader } from 'nextjs-toploader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatRelativeTimeFromNow, serializeAppDate } from '@/lib/date-time'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/lib/notifications/types'

interface NotificationBellProps {
  userId: string | null
}

type BrowserNotificationPermission = NotificationPermission | 'unsupported'

type NotificationRowShape = {
  id: string
  title: string
  message: string
  type: AppNotification['type']
  actionUrl?: string | null
  action_url?: string | null
  purchaseOrderId?: string | null
  purchase_order_id?: string | null
  referenceNumber?: string | null
  reference_number?: string | null
  workflowStage?: string | null
  workflow_stage?: string | null
  targetRole?: string | null
  target_role?: string | null
  isRead?: boolean
  is_read?: boolean
  createdAt?: string | Date
  created_at?: string | Date
  readAt?: string | Date | null
  read_at?: string | Date | null
  metadata?: Record<string, unknown> | null
}

const PERMISSION_DISMISS_KEY = 'po-notification-permission-dismissed'

function formatStageLabel(stage: string | null) {
  if (!stage) {
    return 'Workflow Update'
  }

  return stage.replace(/_/g, ' ')
}

function normalizeNotification(raw: NotificationRowShape): AppNotification {
  const createdAt = raw.createdAt || raw.created_at
  const readAt = raw.readAt || raw.read_at

  return {
    id: raw.id,
    title: raw.title,
    message: raw.message,
    type: raw.type,
    actionUrl: raw.actionUrl || raw.action_url || null,
    purchaseOrderId: raw.purchaseOrderId || raw.purchase_order_id || null,
    referenceNumber: raw.referenceNumber || raw.reference_number || null,
    workflowStage: raw.workflowStage || raw.workflow_stage || null,
    targetRole: raw.targetRole || raw.target_role || null,
    isRead: raw.isRead ?? raw.is_read ?? false,
    createdAt: serializeAppDate(createdAt) || new Date().toISOString(),
    readAt: serializeAppDate(readAt) || null,
    metadata: raw.metadata || {},
  }
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const router = useRouter()
  const topLoader = useTopLoader()
  const supabaseRef = useRef(createClient())
  const audioContextRef = useRef<AudioContext | null>(null)
  const serviceWorkerRegistrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const foregroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notificationsRef = useRef<AppNotification[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [relativeNow, setRelativeNow] = useState(() => new Date())
  const [foregroundNotification, setForegroundNotification] = useState<AppNotification | null>(null)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [hasFreshNotification, setHasFreshNotification] = useState(false)
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false)
  const [permission, setPermission] = useState<BrowserNotificationPermission>('unsupported')

  const fetchNotificationsData = useCallback(async (attempt = 1): Promise<{ notifications?: NotificationRowShape[]; unreadCount?: number }> => {
    let currentAttempt = attempt

    while (currentAttempt <= 3) {
      const response = await fetch('/api/notifications?limit=20', {
        cache: 'no-store',
        credentials: 'same-origin',
      })

      if (response.ok) {
        return response.json()
      }

      if (response.status === 401 || response.status === 403) {
        return { notifications: [], unreadCount: 0 }
      }

      const errorPayload = await response.json().catch(() => null)
      const message = errorPayload?.error || `Failed to fetch notifications (${response.status})`
      if (response.status < 500 || currentAttempt === 3) {
        throw new Error(message)
      }

      await new Promise((resolve) => window.setTimeout(resolve, 350 * currentAttempt))
      currentAttempt += 1
    }

    throw new Error('Failed to fetch notifications')
  }, [])

  const reloadNotifications = useCallback(async () => {
    if (!userId) {
      return
    }

    try {
      const data = await fetchNotificationsData()
      setNotifications((data.notifications || []).map(normalizeNotification))
      setUnreadCount(data.unreadCount || 0)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [fetchNotificationsData, userId])

  const unlockAudioContext = useCallback(async () => {
    if (typeof window === 'undefined') {
      return false
    }

    const audioWindow = window as Window & {
      webkitAudioContext?: typeof AudioContext
    }
    const AudioContextCtor = window.AudioContext || audioWindow.webkitAudioContext

    if (!AudioContextCtor) {
      return false
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor()
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    return audioContextRef.current.state === 'running'
  }, [])

  const playNotificationSound = useCallback(async () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
      return
    }

    const unlocked = await unlockAudioContext()
    const audioContext = audioContextRef.current

    if (!unlocked || !audioContext) {
      return
    }

    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const now = audioContext.currentTime

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18)
    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.09, now + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.26)
  }, [unlockAudioContext])

  const pulseBell = useCallback(() => {
    setHasFreshNotification(true)

    if (freshTimerRef.current) {
      clearTimeout(freshTimerRef.current)
    }

    freshTimerRef.current = setTimeout(() => {
      setHasFreshNotification(false)
    }, 6000)
  }, [])

  const showBackgroundNotification = useCallback(async (notification: AppNotification) => {
    const currentPermission = typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : permission

    if (currentPermission !== permission) {
      setPermission(currentPermission)
    }

    if (currentPermission !== 'granted') {
      return
    }

    const shouldNotifyInBackground = typeof document !== 'undefined'
      ? document.visibilityState !== 'visible' || !document.hasFocus()
      : false

    if (!shouldNotifyInBackground) {
      return
    }

    const payload = {
      title: notification.title,
      body: notification.message,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      actionUrl: notification.actionUrl || '/purchase-orders',
      tag: `po-notification-${notification.id}`,
      referenceNumber: notification.referenceNumber,
      workflowStage: notification.workflowStage,
    }

    try {
      if ('serviceWorker' in navigator) {
        const registration = serviceWorkerRegistrationRef.current || await navigator.serviceWorker.ready
        serviceWorkerRegistrationRef.current = registration

        await registration.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon,
          badge: payload.badge,
          tag: payload.tag,
          data: {
            actionUrl: payload.actionUrl,
          },
        })
        return
      }

      new Notification(payload.title, {
        body: payload.body,
        icon: payload.icon,
        tag: payload.tag,
      })
    } catch (error) {
      console.error('Error showing browser notification:', error)
    }
  }, [permission])

  const mergeNotification = useCallback(async (incoming: AppNotification) => {
    const existing = notificationsRef.current.find((item) => item.id === incoming.id)

    setNotifications((current) => {
      const next = [incoming, ...current.filter((item) => item.id !== incoming.id)]
      return next.slice(0, 20)
    })

    setUnreadCount((current) => {
      if (existing || incoming.isRead) {
        return current
      }

      return current + 1
    })
    pulseBell()
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()) {
      setForegroundNotification(incoming)
      if (foregroundTimerRef.current) {
        clearTimeout(foregroundTimerRef.current)
      }
      foregroundTimerRef.current = setTimeout(() => {
        setForegroundNotification(null)
      }, 6500)
    }
    await Promise.allSettled([
      playNotificationSound(),
      showBackgroundNotification(incoming),
    ])
  }, [playNotificationSound, pulseBell, showBackgroundNotification])

  const updateNotification = useCallback((incoming: AppNotification) => {
    const existing = notificationsRef.current.find((item) => item.id === incoming.id)

    setNotifications((current) => current.map((item) => item.id === incoming.id ? incoming : item))
    setUnreadCount((current) => {
      if (!existing || existing.isRead === incoming.isRead) {
        return current
      }

      return incoming.isRead ? Math.max(0, current - 1) : current + 1
    })
  }, [])

  const dismissPermissionPrompt = () => {
    setPermissionDialogOpen(false)

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(PERMISSION_DISMISS_KEY, 'true')
    }
  }

  const requestBrowserPermission = async () => {
    if (!('Notification' in window)) {
      setPermission('unsupported')
      return
    }

    const result = await Notification.requestPermission()
    setPermission(result)

    if (result === 'granted') {
      setPermissionDialogOpen(false)
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(PERMISSION_DISMISS_KEY)
      }
      await unlockAudioContext()
      return
    }

    setPermissionDialogOpen(true)
  }

  useEffect(() => {
    notificationsRef.current = notifications
  }, [notifications])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const activateAudio = () => {
      void unlockAudioContext()
    }

    window.addEventListener('pointerdown', activateAudio, { passive: true })
    window.addEventListener('keydown', activateAudio)

    return () => {
      window.removeEventListener('pointerdown', activateAudio)
      window.removeEventListener('keydown', activateAudio)
    }
  }, [unlockAudioContext])

  useEffect(() => {
    if (!userId) {
      const timer = window.setTimeout(() => {
        setNotifications([])
        setUnreadCount(0)
        setLoadError(null)
        setLoading(false)
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }

    if (typeof window === 'undefined') {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        setLoading(true)
        const data = await fetchNotificationsData()

        if (cancelled) {
          return
        }

        setNotifications((data.notifications || []).map(normalizeNotification))
        setUnreadCount(data.unreadCount || 0)
        setLoadError(null)
      } catch (error) {
        console.error('Error loading notifications:', error)
        setLoadError(error instanceof Error ? error.message : 'Failed to load notifications')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchNotificationsData, userId])

  useEffect(() => {
    if (!userId || !('serviceWorker' in navigator)) {
      return
    }

    void navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).then(async (registration) => {
      await registration.update().catch(() => undefined)
      serviceWorkerRegistrationRef.current = registration
      const readyRegistration = await navigator.serviceWorker.ready
      serviceWorkerRegistrationRef.current = readyRegistration
    }).catch((error) => {
      console.error('Error registering service worker:', error)
    })
  }, [userId])

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return
    }

    const syncPermission = () => {
      setPermission(Notification.permission)
    }

    syncPermission()
    window.addEventListener('focus', syncPermission)
    document.addEventListener('visibilitychange', syncPermission)

    return () => {
      window.removeEventListener('focus', syncPermission)
      document.removeEventListener('visibilitychange', syncPermission)
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      return
    }

    const dismissed = typeof window !== 'undefined'
      ? window.sessionStorage.getItem(PERMISSION_DISMISS_KEY)
      : null

    if (permission === 'default' && !dismissed) {
      const timer = window.setTimeout(() => {
        setPermissionDialogOpen(true)
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }
  }, [permission, userId])

  useEffect(() => {
    if (!userId) {
      return
    }

    const supabase = supabaseRef.current
    let removed = false
    let fallbackInterval: ReturnType<typeof setInterval> | null = null

    const stopFallbackPolling = () => {
      if (!fallbackInterval) {
        return
      }

      clearInterval(fallbackInterval)
      fallbackInterval = null
    }

    const startFallbackPolling = () => {
      if (removed || fallbackInterval) {
        return
      }

      void reloadNotifications()
      fallbackInterval = setInterval(() => {
        void reloadNotifications()
      }, 15_000)
    }

    const channel = supabase
      .channel(`notifications:${userId}:${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            void mergeNotification(normalizeNotification(payload.new as NotificationRowShape))
            return
          }

          if (payload.eventType === 'UPDATE') {
            updateNotification(normalizeNotification(payload.new as NotificationRowShape))
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          stopFallbackPolling()
          void reloadNotifications()
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startFallbackPolling()
        }
      })

    return () => {
      removed = true
      stopFallbackPolling()
      void supabase.removeChannel(channel)
    }
  }, [mergeNotification, reloadNotifications, updateNotification, userId])

  useEffect(() => {
    const timer = setInterval(() => {
      setRelativeNow(new Date())
    }, 30_000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!userId || typeof window === 'undefined') {
      return
    }

    const refreshOnFocus = () => {
      void reloadNotifications()
    }

    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [reloadNotifications, userId])

  useEffect(() => {
    return () => {
      if (freshTimerRef.current) {
        clearTimeout(freshTimerRef.current)
      }
      if (foregroundTimerRef.current) {
        clearTimeout(foregroundTimerRef.current)
      }
    }
  }, [])

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  )

  const markNotificationRead = async (notificationId: string) => {
    const existing = notificationsRef.current.find((notification) => notification.id === notificationId)

    setNotifications((current) => current.map((notification) => (
      notification.id === notificationId
        ? {
            ...notification,
            isRead: true,
            readAt: notification.readAt || new Date().toISOString(),
          }
        : notification
    )))
    if (existing && !existing.isRead) {
      setUnreadCount((current) => Math.max(0, current - 1))
    }

    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notificationId }),
      })
    } catch (error) {
      console.error('Error marking notification as read:', error)
      void reloadNotifications()
    }
  }

  const markAllAsRead = async () => {
    if (unreadCount === 0) {
      return
    }

    try {
      setMarkingAllRead(true)
      setNotifications((current) => current.map((notification) => ({
        ...notification,
        isRead: true,
        readAt: notification.readAt || new Date().toISOString(),
      })))
      setUnreadCount(0)

      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markAll: true }),
      })
    } catch (error) {
      console.error('Error marking all notifications as read:', error)
      void reloadNotifications()
    } finally {
      setMarkingAllRead(false)
    }
  }

  const isLoading = Boolean(userId) && loading
  const hasPermissionWarning = permission === 'denied' || permission === 'default'

  const handleNotificationClick = async (notification: AppNotification) => {
    if (!notification.isRead) {
      await markNotificationRead(notification.id)
    }

    const targetUrl = notification.actionUrl || '/purchase-orders'

    topLoader.start()

    if (typeof window !== 'undefined') {
      const currentUrl = `${window.location.pathname}${window.location.search}`
      if (currentUrl === targetUrl) {
        topLoader.done()
        return
      }
    }

    router.push(targetUrl)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'relative h-10 w-10 rounded-xl border border-white/70 bg-white/60 text-slate-700 shadow-sm transition-all hover:bg-white/85',
              hasFreshNotification && 'animate-pulse ring-2 ring-[#b9ccde]',
              hasPermissionWarning && 'border-amber-300'
            )}
          >
            {hasFreshNotification ? (
              <BellRing className="h-5 w-5 text-[#023468]" />
            ) : (
              <Bell className={cn('h-5 w-5', hasPermissionWarning ? 'text-amber-600' : 'text-slate-600')} />
            )}
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            {unreadCount === 0 && hasPermissionWarning && (
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[390px] rounded-2xl border-slate-200 bg-white p-0 shadow-2xl">
          <div className="flex items-start justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-bold text-slate-800">Notifications</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {unreadCount} unread
              </p>
            </div>
            <div className="flex items-center gap-2">
              {permission !== 'granted' && permission !== 'unsupported' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPermissionDialogOpen(true)}
                  className="h-8 rounded-lg border-amber-200 bg-amber-50 px-3 text-[10px] font-black uppercase tracking-widest text-amber-700 hover:bg-amber-100"
                >
                  Enable Alerts
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={markAllAsRead}
                disabled={markingAllRead || unreadCount === 0}
                className="h-8 rounded-lg px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#023468]"
              >
                {markingAllRead ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                    Mark all read
                  </>
                )}
              </Button>
            </div>
          </div>
          {permission !== 'granted' && permission !== 'unsupported' && (
            <>
              <DropdownMenuSeparator className="bg-slate-100" />
              <div className="flex items-start gap-3 bg-amber-50 px-4 py-3 text-amber-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-bold">
                    {permission === 'denied' ? 'Browser alerts are blocked' : 'Browser alerts are not enabled'}
                  </p>
                  <p className="text-[11px] leading-5 text-amber-700">
                    Enable notifications to receive instant workflow approvals and order updates when this tab is inactive.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPermissionDialogOpen(true)}
                    className="h-7 rounded-lg px-0 text-[10px] font-black uppercase tracking-widest text-amber-800 hover:bg-transparent hover:text-amber-900"
                  >
                    Review setup
                  </Button>
                </div>
              </div>
            </>
          )}
          <DropdownMenuSeparator className="bg-slate-100" />
          <div className="max-h-[420px] overflow-y-auto p-3">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[#023468]" />
              </div>
            ) : loadError ? (
              <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center">
                <ShieldAlert className="h-8 w-8 text-amber-500" />
                <p className="mt-3 text-sm font-semibold text-slate-700">Notifications could not load</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{loadError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void reloadNotifications()}
                  className="mt-4 rounded-xl border-slate-300"
                >
                  Retry
                </Button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center text-center">
                <Bell className="h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-600">No notifications yet</p>
                <p className="mt-1 text-xs text-slate-400">
                  Workflow updates for your role will appear here in real time.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void handleNotificationClick(notification)}
                    className={cn(
                      'w-full rounded-2xl border p-3 text-left transition-all hover:border-[#8ca8c0] hover:shadow-md',
                      notification.isRead
                        ? 'border-slate-200 bg-white'
                        : 'border-[#b9ccde] bg-[#edf4fb] shadow-sm'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border',
                        notification.isRead
                          ? 'border-slate-200 bg-slate-50 text-slate-500'
                          : 'border-[#b9ccde] bg-white text-[#023468]'
                      )}>
                        {notification.isRead ? (
                          <Bell className="h-4 w-4" />
                        ) : (
                          <BellRing className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="line-clamp-1 text-sm font-bold text-slate-800">
                            {notification.title}
                          </p>
                          <div className="flex items-center gap-2">
                            {!notification.isRead && (
                              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#023468]" />
                            )}
                            <ExternalLink className="mt-0.5 h-3.5 w-3.5 text-slate-300" />
                          </div>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                          {notification.message}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {notification.referenceNumber && (
                            <span>{notification.referenceNumber}</span>
                          )}
                          {notification.workflowStage && (
                            <span>{formatStageLabel(notification.workflowStage)}</span>
                          )}
                          <span>{formatRelativeTimeFromNow(notification.createdAt, relativeNow)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {unreadNotifications > 0 && (
            <>
              <DropdownMenuSeparator className="bg-slate-100" />
              <div className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Unread notifications stay highlighted until you open them or mark them as read.
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {foregroundNotification && (
        <button
          type="button"
          onClick={() => {
            const notification = foregroundNotification
            setForegroundNotification(null)
            void handleNotificationClick(notification)
          }}
          className="fixed right-5 top-20 z-[80] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#b9ccde] bg-white p-4 text-left shadow-2xl transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(2,52,104,0.25)]"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#edf4fb] text-[#023468]">
              <BellRing className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-black text-slate-900">{foregroundNotification.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{foregroundNotification.message}</p>
              <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#023468]">
                {formatRelativeTimeFromNow(foregroundNotification.createdAt, relativeNow)}
              </p>
            </div>
          </div>
        </button>
      )}

      <Dialog open={permissionDialogOpen} onOpenChange={setPermissionDialogOpen}>
        <DialogContent className="rounded-[28px] border-none bg-white p-0 shadow-2xl">
          <div className="rounded-t-[28px] bg-[linear-gradient(135deg,var(--dashboard-action-bg)_0%,var(--dashboard-action-hover)_58%,var(--dashboard-primary-light)_100%)] px-6 py-6 text-white">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/14 text-white shadow-sm">
              <Volume2 className="h-6 w-6" />
            </div>
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-2xl font-black tracking-tight">
                Enable workflow notifications
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-white/88">
                Turn on browser alerts to receive workflow approvals, denials, and stage updates even when this tab is inactive.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-5 px-6 py-6">
            <div className="space-y-3 rounded-3xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-bg)]">
                Why this matters
              </p>
              <ul className="space-y-2 text-sm text-slate-600">
                <li>Receive EA, MD, GRN, Finance, and Accounts workflow updates instantly.</li>
                <li>See order alerts when you are on another tab or the window is minimized.</li>
                <li>Keep the navbar bell and browser alerts synced with the same workflow history.</li>
              </ul>
            </div>

            {permission === 'denied' && (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Browser notification permission is currently blocked. Re-enable it from your browser site settings, then return here and try again.
              </div>
            )}

            <DialogFooter className="gap-2 px-0 pb-0">
              <Button
                type="button"
                variant="outline"
                onClick={dismissPermissionPrompt}
                className="app-outline-action rounded-2xl"
              >
                Later
              </Button>
              <Button
                type="button"
                onClick={() => void requestBrowserPermission()}
                className="app-primary-action rounded-2xl"
              >
                Enable Notifications
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
