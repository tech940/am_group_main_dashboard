import { invalidateCachePattern } from '../lib/redis/cache-utils'

async function run() {
  console.log('Invalidating cache patterns...')
  await invalidateCachePattern('kia:stock-report:*')
  await invalidateCachePattern('kia:sales-report:*')
  await invalidateCachePattern('kia:business-excellence:workshop-summary:*')
  console.log('Cache invalidated successfully.')
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
