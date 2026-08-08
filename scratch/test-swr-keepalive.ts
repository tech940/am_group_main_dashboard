import 'dotenv/config'
import { getCachedData } from '../lib/redis/cache-utils'

/** Exercises the stale-while-revalidate path OUTSIDE a Next request scope: the after() keep-alive
 *  must fall back silently, and the background refresh must still run to completion. */
async function main() {
  let calls = 0
  const fn = async () => { calls++; return { n: calls } }
  const key = 'scratch:swr-test:' + Math.floor(Date.now() / 1000)

  const a = await getCachedData(key, fn, 1)
  console.log('first read (miss -> build):', JSON.stringify(a))

  await new Promise((r) => setTimeout(r, 1500))
  const b = await getCachedData(key, fn, 1)
  console.log('second read (should be stale serve of n=1):', JSON.stringify(b))

  await new Promise((r) => setTimeout(r, 2500))
  const c = await getCachedData(key, fn, 1)
  console.log('third read (should see refreshed n=2):', JSON.stringify(c))
  console.log('builder calls total:', calls, '— expected 2 (initial + background refresh), no crash')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
