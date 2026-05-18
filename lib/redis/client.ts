import { Redis } from '@upstash/redis'

// Initialize Redis client with Upstash
// Add these to your .env.local file:
// UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
// UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token

let redis: Redis | null = null

export function getRedisClient(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('⚠️ Redis credentials not found. Caching disabled.')
    return null
  }

  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    console.log('✅ Redis client initialized')
  }

  return redis
}

// Cache key prefixes for different data types
export const CACHE_KEYS = {
  BUSINESS_EXCELLENCE: 'kia:business-excellence',
  RO_BILLING: 'kia:ro-billing',
} as const

// Cache TTL (Time To Live) in seconds
export const CACHE_TTL = {
  SHORT: 5 * 60,        // 5 minutes
  MEDIUM: 30 * 60,      // 30 minutes
  LONG: 2 * 60 * 60,    // 2 hours
  DAY: 24 * 60 * 60,    // 24 hours
} as const

// Made with Bob
