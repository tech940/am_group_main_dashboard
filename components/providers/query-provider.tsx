'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export const DASHBOARD_STALE_TIME_MS = 15 * 60 * 1000
export const DASHBOARD_GC_TIME_MS = Number.POSITIVE_INFINITY

const SESSION_API_CACHE = new Map<string, { response: Response; expiresAt: number }>()
const SESSION_API_PENDING = new Map<string, Promise<Response>>()
const SESSION_API_CACHE_TTL_MS = 15 * 60 * 1000
const ORIGINAL_FETCH_SYMBOL = Symbol.for('dashboard.originalFetch')
let sessionRefreshPromise: Promise<boolean> | null = null

type FetchWithOriginal = typeof window.fetch & {
  [ORIGINAL_FETCH_SYMBOL]?: typeof window.fetch
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

function shouldUseSessionApiCache(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.cache === 'no-store' || init?.cache === 'reload') return false
  const method = getRequestMethod(input, init)
  if (method !== 'GET') return false

  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin
  )

  if (url.origin !== window.location.origin) return false
  if (!url.pathname.startsWith('/api/')) return false

  // Notifications intentionally stay live because Supabase realtime and unread
  // state should not be frozen by dashboard report caching.
  if (url.pathname.startsWith('/api/notifications')) return false

  return true
}

function createFetchCacheKey(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin
  )
  url.searchParams.sort()
  const credentials = init?.credentials || (input instanceof Request ? input.credentials : 'same-origin')
  return `${getRequestMethod(input, init)}:${url.toString()}:credentials=${credentials}`
}

function clearSessionApiCacheForMutation(input: RequestInfo | URL) {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin
  )
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
    SESSION_API_CACHE.clear()
    SESSION_API_PENDING.clear()
  }
}

async function refreshSessionOnce() {
  if (sessionRefreshPromise) return sessionRefreshPromise

  sessionRefreshPromise = createClient().auth.refreshSession()
    .then(({ data, error }) => !error && Boolean(data.session))
    .catch(() => false)
    .finally(() => {
      sessionRefreshPromise = null
    })

  return sessionRefreshPromise
}

function installSessionApiCache() {
  const currentFetch = window.fetch as FetchWithOriginal
  if (currentFetch[ORIGINAL_FETCH_SYMBOL]) return

  const originalFetch = window.fetch.bind(window)
  const cachedFetch: FetchWithOriginal = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = getRequestMethod(input, init)

    if (!shouldUseSessionApiCache(input, init)) {
      const response = await originalFetch(input, init)
      if (method !== 'GET' && response.ok) {
        clearSessionApiCacheForMutation(input)
      }
      return response
    }

    const cacheKey = createFetchCacheKey(input, init)
    const cached = SESSION_API_CACHE.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.response.clone()
    if (cached) SESSION_API_CACHE.delete(cacheKey)

    const pending = SESSION_API_PENDING.get(cacheKey)
    if (pending) {
      const response = await pending
      return response.clone()
    }

    const request = originalFetch(input, init).then(async (response) => {
      if (response.status === 401 && await refreshSessionOnce()) {
        SESSION_API_CACHE.clear()
        const retriedResponse = await originalFetch(input, init)
        if (retriedResponse.ok) {
          SESSION_API_CACHE.set(cacheKey, {
            response: retriedResponse.clone(),
            expiresAt: Date.now() + SESSION_API_CACHE_TTL_MS,
          })
        }
        SESSION_API_PENDING.delete(cacheKey)
        return retriedResponse
      }

      if (response.ok) {
        SESSION_API_CACHE.set(cacheKey, {
          response: response.clone(),
          expiresAt: Date.now() + SESSION_API_CACHE_TTL_MS,
        })
      }
      SESSION_API_PENDING.delete(cacheKey)
      return response
    }).catch((error) => {
      SESSION_API_PENDING.delete(cacheKey)
      throw error
    })

    SESSION_API_PENDING.set(cacheKey, request)
    return request
  }) as FetchWithOriginal

  cachedFetch[ORIGINAL_FETCH_SYMBOL] = originalFetch
  window.fetch = cachedFetch
}

export function DashboardQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DASHBOARD_STALE_TIME_MS,
        gcTime: DASHBOARD_GC_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        retry: false,
      },
    },
  }))

  if (typeof window !== 'undefined') {
    installSessionApiCache()
  }

  useEffect(() => {
    installSessionApiCache()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
