import { invalidateCachePattern } from '@/lib/redis/cache-utils'

async function main() {
  try {
    console.log('Starting Redis cache invalidation for Kia Business Excellence...')
    
    // Invalidate the relational excel raw data sheet cache
    await invalidateCachePattern('kia:business-excellence:*')
    
    // Invalidate the service dashboard metrics cache (overview, KPIs)
    await invalidateCachePattern('kia:service-dashboard:*')
    
    console.log('Redis cache successfully invalidated for all Kia Business Excellence and dashboard keys!')
    process.exit(0)
  } catch (error) {
    console.error('Failed to invalidate Redis cache:', error)
    process.exit(1)
  }
}

main()
