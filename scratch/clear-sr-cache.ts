import 'dotenv/config'
import { invalidateCachePattern } from '../lib/redis/cache-utils'

invalidateCachePattern('kia:sales-report:*')
  .then(() => { console.log('sales-report cache cleared'); process.exit(0) })
  .catch((e) => { console.error(e); process.exit(1) })
