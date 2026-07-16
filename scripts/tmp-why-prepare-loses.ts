import 'dotenv/config'
import postgres from 'postgres'

// READ-ONLY. Only SELECTs.
const u = new URL(process.env.DATABASE_URL!)
u.port = '6543'
u.searchParams.delete('pgbouncer')

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// Isolate: is the prepare:true regression caused by the POOL (per-connection statement cache
// never warms because queries hop connections) or by Supavisor itself?
async function fanout(prepare: boolean, max: number) {
  const sql = postgres(u.toString(), { max, prepare, ssl: { rejectUnauthorized: false }, idle_timeout: 30 })
  try {
    const [row] = await sql`select id from kia_bookings where deleted_at is null limit 1`
    const id = row.id as string

    // 5 concurrent queries = the bookings.ts:991-1016 wave shape
    const wave = () => Promise.all([
      sql`select * from kia_bookings where id = ${id} and deleted_at is null limit ${1}`,
      sql`select * from kia_vehicle_allocations where booking_id = ${id} and released_at is null limit ${1}`,
      sql`select id, activity_type from kia_booking_activity where booking_id = ${id} order by created_at desc limit ${100}`,
      sql`select id, vin_number from kia_vehicle_transfers where booking_id = ${id} order by created_at desc limit ${50}`,
      sql`select id, approval_status from kia_proformas limit ${1}`,
    ])

    const t: number[] = []
    for (let i = 0; i < 25; i++) {
      const s = process.hrtime.bigint()
      await wave()
      t.push(Number(process.hrtime.bigint() - s) / 1e6)
    }
    // late window: if the per-connection cache ever warms, the tail converges
    console.log(`  prepare:${String(prepare).padEnd(5)} max:${max}  cold ${t[0].toFixed(0).padStart(5)}ms | early-med ${med(t.slice(1, 8)).toFixed(0).padStart(4)}ms | LATE-med ${med(t.slice(15)).toFixed(0).padStart(4)}ms`)
    return med(t.slice(15))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main() {
  console.log('\n=== 5-query concurrent wave, 25 reps, tail = fully warm ===')
  const a = await fanout(false, 6)
  const b = await fanout(true, 6)
  const c = await fanout(false, 1)
  const d = await fanout(true, 1)
  console.log('\n--- verdict ---')
  console.log(`  pooled (max:6, production shape): prepare:false ${a.toFixed(0)}ms vs prepare:true ${b.toFixed(0)}ms -> prepare:true is ${(b - a).toFixed(0)}ms ${b > a ? 'WORSE' : 'better'}`)
  console.log(`  pinned (max:1, artificial):       prepare:false ${c.toFixed(0)}ms vs prepare:true ${d.toFixed(0)}ms -> prepare:true is ${(d - c).toFixed(0)}ms ${d > c ? 'WORSE' : 'better'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
