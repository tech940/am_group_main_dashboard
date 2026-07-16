import 'dotenv/config'
import postgres from 'postgres'

// Replicates the getKiaBookingDetail wave-2 fan-out (lib/kia/bookings.ts:991-1016)
// and tests the finding's core causal claim: is DB_POOL_MAX=6 the bottleneck?
// Decisive counterfactual: same concurrency, pool max 6 vs pool max 24.

const URL = process.env.DATABASE_URL!

function mk(max: number) {
  return postgres(URL, { max, prepare: false, ssl: { rejectUnauthorized: false }, idle_timeout: 60 })
}

// One "wave 2" = `queries` concurrent statements, mirroring the real projections.
function wave(sql: postgres.Sql, bookingId: string, queries: number) {
  const all = [
    sql`SELECT * FROM kia_vehicle_allocations WHERE booking_id = ${bookingId} AND released_at IS NULL LIMIT 1`,
    sql`SELECT id, activity_type, title, actor_name, created_at FROM kia_booking_activity WHERE booking_id = ${bookingId} ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT id, vin_number, from_dealer_code, to_dealer_code, transfer_status, created_at FROM kia_vehicle_transfers WHERE booking_id = ${bookingId} ORDER BY created_at DESC LIMIT 50`,
    sql`SELECT id, approval_status, created_at FROM kia_proformas LIMIT 1`,
    sql`SELECT id, order_number, status, created_at FROM finance_orders LIMIT 1`,
  ]
  return Promise.all(all.slice(0, queries))
}

async function warm(sql: postgres.Sql, max: number) {
  // Force every physical connection open (TCP+TLS handshake) BEFORE timing.
  await Promise.all(Array.from({ length: max }, () => sql`SELECT 1`))
  await Promise.all(Array.from({ length: max }, () => sql`SELECT 1`))
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

async function bench(sql: postgres.Sql, bookingId: string, concurrent: number, queries: number, reps = 5) {
  const runs: number[] = []
  for (let i = 0; i < reps; i++) {
    const t = Date.now()
    await Promise.all(Array.from({ length: concurrent }, () => wave(sql, bookingId, queries)))
    runs.push(Date.now() - t)
  }
  return median(runs)
}

async function main() {
  const probe = postgres(URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })
  const [b] = await probe`SELECT id FROM kia_bookings WHERE deleted_at IS NULL LIMIT 1`
  const bookingId = b.id as string
  const t0 = Date.now()
  await probe`SELECT 1`
  const rtt = Date.now() - t0
  console.log(`booking ${bookingId} | single RTT ~${rtt}ms\n`)
  await probe.end()

  for (const queries of [5, 3]) {
    console.log(`=== wave fan-out = ${queries} queries ===`)
    for (const max of [6, 24]) {
      const sql = mk(max)
      await warm(sql, max)
      const out: string[] = []
      for (const c of [1, 2, 3]) {
        const ms = await bench(sql, bookingId, c, queries)
        out.push(`${c} conc (${c * queries} q) = ${String(ms).padStart(5)}ms`)
      }
      console.log(`  pool max ${String(max).padStart(2)}: ${out.join('  |  ')}`)
      await sql.end()
    }
    console.log()
  }
}
main()
