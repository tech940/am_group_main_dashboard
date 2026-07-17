/* TEMP probe — module-scope EXECUTION cost (what a COLD instance pays before handling req #1).
   Run twice; the 2nd run reads tsx's transpile cache, so it is closer to pure execution. */
const marks: Array<[string, number]> = []
async function step(label: string, fn: () => Promise<unknown>) {
  const t0 = process.hrtime.bigint()
  await fn()
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  marks.push([label, ms])
  console.log('  ' + label.padEnd(44) + ms.toFixed(1).padStart(8) + ' ms')
}

async function main() {
  console.log('=== module EXECUTION cost of the bookings route graph (fresh process) ===')
  await step('drizzle-orm/postgres-js', () => import('drizzle-orm/postgres-js'))
  await step('postgres (driver)', () => import('postgres'))
  await step('@/lib/db/schema  (drizzle table defs)', () => import('@/lib/db/schema'))
  await step('@/lib/permissions/registry', () => import('@/lib/permissions/registry'))
  await step('@/lib/permissions/tiers', () => import('@/lib/permissions/tiers'))
  await step('@supabase/supabase-js', () => import('@supabase/supabase-js'))
  await step('@supabase/ssr', () => import('@supabase/ssr'))
  await step('@upstash/redis', () => import('@upstash/redis'))
  await step('@/lib/kia/bookings', () => import('@/lib/kia/bookings'))
  await step('@/lib/permissions/service', () => import('@/lib/permissions/service'))

  const total = marks.reduce((a, [, ms]) => a + ms, 0)
  console.log('  ' + '-'.repeat(52))
  console.log('  ' + 'TOTAL module eval (app graph only)'.padEnd(44) + total.toFixed(1).padStart(8) + ' ms')
  console.log()
  console.log('  NOTE: excludes the Next.js server runtime bootstrap, which a real cold start')
  console.log('  ALSO pays (next chunks = 1.36 MB traced on every route).')
}
main()
