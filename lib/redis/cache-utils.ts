import { getRedisClient, CACHE_TTL } from './client'

/**
 * Generic cache wrapper for API data.
 */
export async function getCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = CACHE_TTL.MEDIUM
): Promise<T> {
  const redis = getRedisClient()

  if (!redis) {
    return await fetchFn()
  }

  try {
    const cached = await redis.get<unknown>(key)

    if (cached !== null && cached !== undefined) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`Cache HIT for key: ${key}`)
      }

      if (typeof cached === 'string') {
        try {
          return JSON.parse(cached) as T
        } catch {
          return cached as T
        }
      }

      return cached as T
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Cache MISS for key: ${key}`)
    }

    const data = await fetchFn()
    await redis.setex(key, ttl, data)

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Cached data for key: ${key} (TTL: ${ttl}s)`)
    }

    return data
  } catch (error) {
    console.error('Redis error:', error)
    return await fetchFn()
  }
}

export async function invalidateCache(key: string): Promise<void> {
  const redis = getRedisClient()

  if (!redis) return

  try {
    await redis.del(key)
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
