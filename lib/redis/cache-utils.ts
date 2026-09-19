import { getRedisClient, CACHE_TTL } from './client'
import { recordCacheStatus } from '@/lib/api/timing'

export { CACHE_TTL } from './client'

// Force-reload memory cache (v2) to clear any stale in-memory fallbacks after SQL/UI updates
const L1_MAX_ENTRIES = 250
const STALE_TTL_SECONDS = 2 * 60 * 60

type L1Entry = {
  value: unknown
  freshUntil: number
  staleUntil: number
}

const l1Cache = new Map<string, L1Entry>()
const pendingFetches = new Map<string, Promise<unknown>>()

function setL1(key: string, value: unknown, ttl: number, keepStale = true) {
  if (l1Cache.size >= L1_MAX_ENTRIES && !l1Cache.has(key)) {
    const oldestKey = l1Cache.keys().next().value
    if (oldestKey) l1Cache.delete(oldestKey)
  }

  const now = Date.now()
  l1Cache.set(key, {
    value,
    freshUntil: now + ttl * 1000,
    // A short-lived value (see CacheOptions.ttlFor) must not linger as a stale fallback either.
    staleUntil: now + (keepStale ? ttl + STALE_TTL_SECONDS : ttl) * 1000,
  })
}

/** Optional per-call behaviour for getCachedData. Omitting it keeps the long-standing behaviour exactly. */
export type CacheOptions<T> = {
  /**
   * Cache THIS value for fewer seconds than `ttl` — return a number to do so, or null/undefined for the normal
   * TTL. Meant for a value that is incomplete (e.g. a dashboard section that timed out): it should be retried
   * soon rather than served for the full TTL. Such a value is also never written to the `:stale` twin, so the
   * last COMPLETE value stays the fallback instead of being overwritten by a partial one.
   */
  ttlFor?: (value: T) => number | null | undefined
}

function effectiveTtl<T>(value: T, ttl: number, options?: CacheOptions<T>): { ttl: number; keepStale: boolean } {
  const override = options?.ttlFor?.(value)
  return typeof override === 'number' && override > 0 && override < ttl
    ? { ttl: override, keepStale: false }
    : { ttl, keepStale: true }
}

async function writeRedis(redis: NonNullable<ReturnType<typeof getRedisClient>>, key: string, value: unknown, ttl: number, keepStale: boolean) {
  await Promise.all([
    redis.setex(key, ttl, value),
    ...(keepStale ? [redis.setex(`${key}:stale`, ttl + STALE_TTL_SECONDS, value)] : []),
  ])
}

function readL1<T>(key: string) {
  const entry = l1Cache.get(key)
  if (!entry) return null
  const now = Date.now()
  if (entry.staleUntil <= now) {
    l1Cache.delete(key)
    return null
  }
  return {
    value: entry.value as T,
    fresh: entry.freshUntil > now,
  }
}

function parseCachedValue<T>(cached: unknown): T {
  if (typeof cached === 'string') {
    try {
      return JSON.parse(cached) as T
    } catch {
      return cached as T
    }
  }
  return cached as T
}

async function fetchSingleFlight<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number,
  options?: CacheOptions<T>
) {
  const existing = pendingFetches.get(key)
  if (existing) {
    recordCacheStatus('COALESCED')
    return await existing as T
  }

  const work = (async () => {
    const value = await fetchFn()
    const eff = effectiveTtl(value, ttl, options)
    setL1(key, value, eff.ttl, eff.keepStale)
    return value
  })()
  pendingFetches.set(key, work)
  try {
    return await work
  } finally {
    pendingFetches.delete(key)
  }
}

/**
 * Keep a background promise alive past the end of the request.
 *
 * ⚠️ On Vercel the instance is FROZEN the moment the response is sent, so a plain fire-and-forget
 * promise never completes there. That killed every stale-while-revalidate refresh: the `:stale`
 * key was served for up to 2 hours without a single rebuild landing, and when it finally expired
 * the full cold rebuild ran INSIDE a request — the Group Cockpit's intermittent
 * "Failed to fetch" was that rebuild being killed at the platform time limit.
 *
 * `after()` pins the invocation via waitUntil until the promise settles. It only exists inside a
 * Next request scope — under tsx scripts and crons the import/call throws, and the catch falls
 * back to plain fire-and-forget, which is correct there because the process outlives the promise
 * anyway.
 */
function keepAlivePastResponse(work: Promise<unknown>) {
  void import('next/server')
    .then(({ after }) => after(work))
    .catch(() => {})
}

function refreshInBackground<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number,
  writeRemote: (value: T) => Promise<void>,
  options?: CacheOptions<T>
) {
  if (pendingFetches.has(key)) return
  const work = (async () => {
    const value = await fetchFn()
    const eff = effectiveTtl(value, ttl, options)
    setL1(key, value, eff.ttl, eff.keepStale)
    await writeRemote(value)
    return value
  })()
  pendingFetches.set(key, work)
  const settled = work.catch((error) => {
    console.error(`Background cache refresh failed for ${key}:`, error)
  }).finally(() => {
    pendingFetches.delete(key)
  })
  keepAlivePastResponse(settled)
}

/**
 * Generic cache wrapper for API data.
 */
export async function getCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = CACHE_TTL.MEDIUM,
  options?: CacheOptions<T>
): Promise<T> {
  const local = readL1<T>(key)
  if (local?.fresh) {
    recordCacheStatus('L1-HIT')
    return local.value
  }

  const redis = getRedisClient()

  if (!redis) {
    if (local) {
      recordCacheStatus('L1-STALE')
      refreshInBackground(key, fetchFn, ttl, async () => {}, options)
      return local.value
    }
    recordCacheStatus('MISS')
    return await fetchSingleFlight(key, fetchFn, ttl, options)
  }

  try {
    const cached = await redis.get<unknown>(key)

    if (cached !== null && cached !== undefined) {
      const value = parseCachedValue<T>(cached)
      // A short-lived value keeps its short life in L1 too — otherwise L1 would hold it for the full TTL.
      const eff = effectiveTtl(value, ttl, options)
      setL1(key, value, eff.ttl, eff.keepStale)
      recordCacheStatus('REDIS-HIT')
      if (process.env.NODE_ENV !== 'production') {
        console.log(`Cache HIT for key: ${key}`)
      }
      return value
    }

    const staleKey = `${key}:stale`
    const stale = local?.value ?? parseCachedValue<T | null>(await redis.get<unknown>(staleKey))
    if (stale !== null && stale !== undefined) {
      setL1(key, stale, ttl)
      const staleEntry = l1Cache.get(key)
      if (staleEntry) staleEntry.freshUntil = 0
      recordCacheStatus('STALE')
      refreshInBackground(key, fetchFn, ttl, async (value) => {
        const eff = effectiveTtl(value, ttl, options)
        await writeRedis(redis, key, value, eff.ttl, eff.keepStale)
      }, options)
      return stale
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Cache MISS for key: ${key}`)
    }

    recordCacheStatus('MISS')
    const data = await fetchSingleFlight(key, fetchFn, ttl, options)
    try {
      const eff = effectiveTtl(data, ttl, options)
      await writeRedis(redis, key, data, eff.ttl, eff.keepStale)
    } catch (error) {
      console.error(`Redis write failed for key ${key}:`, error)
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Cached data for key: ${key} (TTL: ${ttl}s)`)
    }

    return data
  } catch (error) {
    console.error('Redis error:', error)
    if (local) {
      recordCacheStatus('L1-STALE')
      return local.value
    }
    recordCacheStatus('MISS')
    return await fetchSingleFlight(key, fetchFn, ttl, options)
  }
}

/**
 * Write a value straight into the cache — L1, the key and its `:stale` twin — as if it had just been built.
 * For scheduled warmers that build a payload off the request path, so the next viewer never waits.
 */
export async function setCachedData<T>(key: string, value: T, ttl: number): Promise<void> {
  setL1(key, value, ttl)
  const redis = getRedisClient()
  if (!redis) return
  try {
    await writeRedis(redis, key, value, ttl, true)
  } catch (error) {
    console.error(`Redis write failed for key ${key}:`, error)
  }
}

export async function invalidateCache(key: string): Promise<void> {
  l1Cache.delete(key)
  l1Cache.delete(`${key}:stale`)
  const redis = getRedisClient()

  if (!redis) return

  try {
    await redis.del(key, `${key}:stale`)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Cache invalidated for key: ${key}`)
    }
  } catch (error) {
    console.error('Error invalidating cache:', error)
  }
}

export async function invalidateCachePattern(pattern: string): Promise<void> {
  // Build a regex that treats ':' literally (no escaping needed — only '*' is a wildcard)
  const regexPattern = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  for (const key of l1Cache.keys()) {
    if (regexPattern.test(key)) {
      l1Cache.delete(key)
    }
  }

  const redis = getRedisClient()
  if (!redis) return

  try {
    let cursor = '0'
    let deletedCount = 0

    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: pattern,
        count: 100,
      })

      cursor = nextCursor

      if (keys.length > 0) {
        // Also delete the stale twin keys so SWR doesn't serve stale data after invalidation
        const staleKeys = keys.map((k) => `${k}:stale`)
        await redis.del(...keys, ...staleKeys)
        deletedCount += keys.length
      }
    } while (cursor !== '0')

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Cache pattern invalidated: ${pattern} (${deletedCount} keys)`)
    }
  } catch (error) {
    console.error('Error invalidating cache pattern:', error)
  }
}

export async function getCacheStats(key: string): Promise<{
  exists: boolean
  ttl: number | null
}> {
  const redis = getRedisClient()

  if (!redis) {
    return { exists: false, ttl: null }
  }

  try {
    const exists = await redis.exists(key)
    const ttl = exists ? await redis.ttl(key) : null

    return { exists: exists === 1, ttl }
  } catch (error) {
    console.error('Error getting cache stats:', error)
    return { exists: false, ttl: null }
  }
}
