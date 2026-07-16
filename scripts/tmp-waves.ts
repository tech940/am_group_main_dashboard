import 'dotenv/config'
import { db, analyticsDb } from '@/lib/db'
import { kiaBookings, kiaProformas } from '@/lib/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

const APPROVED = '4f22c55b-c0b4-4658-a6e2-62f8b89bab26'
const PENDING = process.env.PENDING_ID!

async function main() {
  // warm the pool
  await db.select().from(kiaBookings).where(eq(kiaBookings.id, APPROVED)).limit(1)

  // Wave 1 of getKiaBookingMatchingVehicles (bookings.ts:1319)
  let t0 = performance.now()
  const [booking] = await db.select().from(kiaBookings).where(and(eq(kiaBookings.id, APPROVED), isNull(kiaBookings.deletedAt))).limit(1)
  const w1 = performance.now() - t0

  // Wave 2 (bookings.ts:1322) — approvalStatus is ONLY known after this
  t0 = performance.now()
  const [p] = await db.select({ approvalStatus: kiaProformas.approvalStatus }).from(kiaProformas).where(eq(kiaProformas.id, booking.proformaId!)).limit(1)
  const w2 = performance.now() - t0

  // Wave 3 — the big matching query (bookings.ts:1328+), timed in isolation
  const modelPattern = `%${booking.model}%`
  const variantPattern = `%${booking.variant}%`
  t0 = performance.now()
  await analyticsDb.execute(sql`
    WITH active_allocations AS (
      SELECT vin_number FROM kia_vehicle_allocations
      WHERE released_at IS NULL AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
    )
    SELECT count(*) FROM kia_stock_management sm
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
    WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
      AND coalesce(ls.local_status,'') NOT IN ('retail','hold_customer','hold_dealer')
      AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
      AND sm.model ILIKE ${modelPattern}
      AND (coalesce(sm.variant,'') = '' OR sm.variant ILIKE ${variantPattern})`)
  const w3 = performance.now() - t0

  console.log('getKiaBookingMatchingVehicles internal waves (APPROVED):')
  console.log(`  wave1 booking select   (:1319) = ${w1.toFixed(0)} ms`)
  console.log(`  wave2 proforma select  (:1322) = ${w2.toFixed(0)} ms   <- approvalStatus known ONLY here`)
  console.log(`  wave3 big match query  (:1328) = ${w3.toFixed(0)} ms`)
  console.log(`  sum = ${(w1 + w2 + w3).toFixed(0)} ms  (3 SEQUENTIAL waves)`)

  // Cost the "cheaper alternative" inflicts on non-APPROVED opens
  const { getKiaBookingMatchingVehicles } = await import('@/lib/kia/bookings')
  await getKiaBookingMatchingVehicles(PENDING)
  const ts: number[] = []
  for (let i = 0; i < 3; i++) { const s = performance.now(); await getKiaBookingMatchingVehicles(PENDING); ts.push(performance.now() - s) }
  console.log(`\nmatching(PENDING) early-return at :1323 = ${ts.map(t=>t.toFixed(0)).join(', ')} ms (2 wasted waves x 49/53 opens under the "parallel" fix)`)
  process.exit(0)
}
main()
