'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const SESSION_ID_KEY = 'app.activity.session_id'
const LAST_EVENT_PREFIX = 'app.activity.last.'
const DUPLICATE_WINDOW_MS = 15_000

function getSessionId() {
  if (typeof window === 'undefined') return null

  const existing = window.sessionStorage.getItem(SESSION_ID_KEY)
  if (existing) return existing

  const next = window.crypto.randomUUID()
  window.sessionStorage.setItem(SESSION_ID_KEY, next)
  return next
}

function shouldSkipEvent(signature: string) {
  if (typeof window === 'undefined') return true
  const key = `${LAST_EVENT_PREFIX}${signature}`
  const now = Date.now()
  const lastSeen = Number(window.sessionStorage.getItem(key) || 0)
  if (Number.isFinite(lastSeen) && now - lastSeen < DUPLICATE_WINDOW_MS) return true
  window.sessionStorage.setItem(key, String(now))
  return false
}

export function ActivityTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!pathname || pathname.startsWith('/auth')) return

    const routeQuery = searchParams?.toString() || ''
    const signature = `${pathname}?${routeQuery}`
    if (shouldSkipEvent(signature)) return

    const sessionId = getSessionId()
    const payload = {
      eventType: 'page_view',
      routePath: pathname,
      routeQuery,
      pageTitle: document.title || null,
      metadata: {
        href: window.location.href,
        referrer: document.referrer || null,
      },
    }

    void fetch('/api/activity', {
      method: 'POST',
      keepalive: true,
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-client-session-id': sessionId || '',
      },
      body: JSON.stringify(payload),
    }).catch(() => null)
  }, [pathname, searchParams])

  return null
}
