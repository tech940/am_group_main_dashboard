import 'dotenv/config'
import { getRedisClient } from '../lib/redis/client'

async function main() {
  console.log('Fetching Redis client...')
  const redis = getRedisClient()
  if (!redis) {
    console.error('Redis client could not be initialized.')
    process.exit(1)
  }

  console.log('Testing Redis ping...')
  const start = Date.now()
  try {
    const res = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 5000ms')), 5000))
    ])
    console.log(`Redis ping response: ${res} in ${Date.now() - start}ms`)
  } catch (err: any) {
    console.error(`Redis ping failed:`, err.message)
  }
  process.exit(0)
}

main()
