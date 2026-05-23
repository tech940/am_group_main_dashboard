import { getRedisClient, CACHE_TTL } from './client'

/**
 * Generic cache wrapper for API data
 * @param key - Cache key
 * @param fetchFn - Function to fetch data if cache miss
 * @param ttl - Time to live in seconds (default: 30 minutes)
 * @returns Cached or fresh data
 */
export async function getCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = CACHE_TTL.MEDIUM
): Promise<T> {
  const redis = getRedisClient()

  // If Redis is not configured, bypass cache
  if (!redis) {
    console.log('🔄 Redis not configured, fetching fresh data')
    return await fetchFn()
  }

  try {
    // Try to get from cache
    const cached = await redis.get<T>(key)
    
    if (cached) {
      console.log(`✅ Cache HIT for key: ${key}`)
      return cached
    }

    console.log(`❌ Cache MISS for key: ${key}`)
    
    // Fetch fresh data
    const data = await fetchFn()
    
    // Store in cache with TTL
    await redis.setex(key, ttl, JSON.stringify(data))
    console.log(`💾 Cached data for key: ${key} (TTL: ${ttl}s)`)
    
    return data
  } catch (error) {
    console.error('❌ Redis error:', error)
    // Fallback to fetching without cache
    return await fetchFn()
  }
}

/**
 * Invalidate cache for a specific key
 * @param key - Cache key to invalidate
 */
export async function invalidateCache(key: string): Promise<void> {
  const redis = getRedisClient()
  
  if (!redis) {
    console.log('⚠️ Redis not configured, skipping cache invalidation')
    return
  }

  try {
    await redis.del(key)
    console.log(`🗑️ Cache invalidated for key: ${key}`)
  } catch (error) {
    console.error('❌ Error invalidating cache:', error)
  }
}

/**
 * Invalidate all caches matching a pattern
 * @param pattern - Pattern to match (e.g., "kia:*")
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  const redis = getRedisClient()
  
  if (!redis) {
    console.log('⚠️ Redis not configured, skipping cache invalidation')
    return
  }

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

    console.log(`Cache pattern invalidated: ${pattern} (${deletedCount} keys)`)
  } catch (error) {
    console.error('❌ Error invalidating cache pattern:', error)
  }
}

/**
 * Get cache statistics
 */
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
    console.error('❌ Error getting cache stats:', error)
    return { exists: false, ttl: null }
  }
}

// Made with Bob
