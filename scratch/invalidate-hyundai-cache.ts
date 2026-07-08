import 'dotenv/config'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'

async function main() {
  try {
    console.log('Starting Redis cache invalidation for Hyundai Business Excellence...')
    
    // Invalidate the relational excel raw data sheet cache and ro-billing-analysis cache
    await invalidateCachePattern('hyundai:business-excellence:*')
    
    // Invalidate the service dashboard metrics cache (overview, KPIs)
    await invalidateCachePattern('hyundai:service-dashboard:*')
    
    console.log('Redis cache successfully invalidated for all Hyundai Business Excellence keys!')
    process.exit(0)
  } catch (error) {
    console.error('Failed to invalidate Redis cache:', error)
    process.exit(1)
  }
}

main()
