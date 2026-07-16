import 'dotenv/config'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL!
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]

type SQL = ReturnType<typeof postgres>

// Emulates getKiaBookingDetail's wave 2 (lib/kia/bookings.ts:991-1016), parameterized exactly as drizzle emits.
function wave(sql: SQL, bookingId: string, proformaId: string | null, fanout: number) {
  const qs: Promise<unknown>[] = [
    sql`SELECT * FROM kia_vehicle_allocations WHERE booking_id = ${bookingId} AND released_at IS NULL LIMIT 1`,
    sql`SELECT id, activity_type, title, actor_name, created_at FROM kia_booking_activity WHERE booking_id = ${bookingId} ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT id, vin_number, from_dealer_code, to_dealer_code, transfer_status, created_at FROM kia_vehicle_transfers WHERE booking_id = ${bookingId} ORDER BY created_at DESC LIMIT 50`,
  ]
  if (fanout >= 4 && proformaId) qs.push(sql`SELECT id, approval_status, created_at FROM kia_proformas WHERE id = ${proformaId} LIMIT 1`)
  // fanout 5 = the finding's claimed shape (finance_orders is empty in reality, so synthesise it)
  if (fanout >= 5) qs.push(sql`SELECT id, order_number, status, created_at FROM finance_orders WHERE id = ${bookingId} LIMIT 1`)
  return Promise.all(qs)
}

async function bench(poolMax: number, concurrency: number, fanout: number, bookingId: string, proformaId: string | null) {
  const sql = postgres(URL, { max: poolMax, prepare: false, ssl: { rejectUnauthorized: false }, idle_timeout: 120, connect_timeout: 15 })
  // Warm: force `poolMax` physical connections open so we never measure TLS handshakes.
  await Promise.all(Array.from({ length: poolMax }, () => sql`SELECT pg_sleep(0.3)`))
  for (let i = 0; i < 2; i++) await Promise.all(Array.from({ length: concurrency }, () => wave(sql, bookingId, proformaId, fanout)))

  const runs: number[] = []
  for (let i = 0; i < 5; i++) {
    const t = performance.now()
    await Promise.all(Array.from({ length: concurrency }, () => wave(sql, bookingId, proformaId, fanout)))
    runs.push(performance.now() - t)
  }
  await sql.end({ timeout: 5 })
  return median(runs)
}

async function main() {
  const probe = postgres(URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })
  const [b] = await probe`SELECT id, proforma_id FROM kia_bookings WHERE deleted_at IS NULL AND proforma_id IS NOT NULL LIMIT 1`
  const bookingId = b.id as string
  const proformaId = b.proforma_id as string

  const rtts: number[] = []
  for (let i = 0; i < 10; i++) { const t = performance.now(); await probe`SELECT 1`; rtts.push(performance.now() - t) }
  const RTT = median(rtts)
  console.log(`baseline RTT (SELECT 1, no params) = ${RTT.toFixed(1)} ms\n`)
  await probe.end()

  for (const fanout of [4, 5]) {
    console.log(`===== fan-out ${fanout} queries/request ${fanout === 4 ? '(REAL max today)' : '(the finding\'s CLAIMED shape)'} =====`)
    const rows: Record<string, string>[] = []
    for (const concurrency of [1, 2, 3]) {
      const row: Record<string, string> = { 'concurrent reqs': String(concurrency), 'total queries': String(concurrency * fanout) }
      for (const poolMax of [4, 6, 12, 20]) {
        const ms = await bench(poolMax, concurrency, fanout, bookingId, proformaId)
        row[`pool=${poolMax}`] = `${ms.toFixed(0)}ms (${(ms / RTT).toFixed(1)}x)`
      }
      rows.push(row)
    }
    console.table(rows)
    console.log()
  }
}
main()
