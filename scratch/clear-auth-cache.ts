import 'dotenv/config'
import { getRedisClient } from '../lib/redis/client'

async function main() {
  const redis = getRedisClient()
  if (!redis) {
    console.log('Redis client not available, skipping Redis cache flush.')
    return
  }

  console.log('Fetching keys matching "auth:app-user:*"...')
  const keys = await redis.keys('auth:app-user:*')
  console.log('Found user cache keys:', keys)

  if (keys.length > 0) {
    console.log(`Deleting ${keys.length} keys...`)
    await redis.del(...keys)
    console.log('Deleted successfully.')
  }

  console.log('Fetching keys matching "permissions:*"...')
  const permKeys = await redis.keys('permissions:*')
  console.log('Found permission cache keys:', permKeys)

  if (permKeys.length > 0) {
    console.log(`Deleting ${permKeys.length} permission keys...`)
    await redis.del(...permKeys)
    console.log('Deleted successfully.')
  }

  console.log('Cache cleared successfully!')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
