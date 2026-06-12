import { getRedisClient, CACHE_TTL } from './client'
import { recordCacheStatus } from '@/lib/api/timing'

const L1_MAX_ENTRIES = 250
const STALE_TTL_SECONDS = 2 * 60 * 60

type L1Entry = {
  value: unknown
  freshUntil: number
  staleUntil: number
}

const l1Cache = new Map<string, L1Entry>()
const pendingFetches = new Map<string, Promise<unknown>>()

function setL1(key: string, value: unknown, ttl: number) {
  if (l1Cache.size >= L1_MAX_ENTRIES && !l1Cache.has(key)) {
    const oldestKey = l1Cache.keys().next().value
    if (oldestKey) l1Cache.delete(oldestKey)
  }

  const now = Date.now()
  l1Cache.set(key, {
    value,
    freshUntil: now + ttl * 1000,
    staleUntil: now + (ttl + STALE_TTL_SECONDS) * 1000,
  })
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
  ttl: number
) {
  const existing = pendingFetches.get(key)
  if (existing) {
    recordCacheStatus('COALESCED')
    return await existing as T
  }

  const work = (async () => {
    const value = await fetchFn()
    setL1(key, value, ttl)
    return value
  })()
  pendingFetches.set(key, work)
  try {
    return await work
  } finally {
    pendingFetches.delete(key)
  }
}

function refreshInBackground<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number,
  writeRemote: (value: T) => Promise<void>
) {
  if (pendingFetches.has(key)) return
  const work = (async () => {
    const value = await fetchFn()
    setL1(key, value, ttl)
    await writeRemote(value)
    return value
  })()
  pendingFetches.set(key, work)
  void work.catch((error) => {
    console.error(`Background cache refresh failed for ${key}:`, error)
  }).finally(() => {
    pendingFetches.delete(key)
  })
}

/**
 * Generic cache wrapper for API data.
 */
export async function getCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = CACHE_TTL.MEDIUM
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
      refreshInBackground(key, fetchFn, ttl, async () => {})
      return local.value
    }
    recordCacheStatus('MISS')
    return await fetchSingleFlight(key, fetchFn, ttl)
  }

  try {
    const cached = await redis.get<unknown>(key)

    if (cached !== null && cached !== undefined) {
      const value = parseCachedValue<T>(cached)
      setL1(key, value, ttl)
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
        await Promise.all([
          redis.setex(key, ttl, value),
          redis.setex(staleKey, ttl + STALE_TTL_SECONDS, value),
        ])
      })
      return stale
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Cache MISS for key: ${key}`)
    }

    recordCacheStatus('MISS')
    const data = await fetchSingleFlight(key, fetchFn, ttl)
    try {
      await Promise.all([
        redis.setex(key, ttl, data),
        redis.setex(staleKey, ttl + STALE_TTL_SECONDS, data),
      ])
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
    return await fetchSingleFlight(key, fetchFn, ttl)
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
        await redis.del(...keys)
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
