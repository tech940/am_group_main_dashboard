import 'dotenv/config'
import postgres from 'postgres'

// READ-ONLY. Only SELECTs.
const u = new URL(process.env.DATABASE_URL!)
u.port = '6543'
u.searchParams.delete('pgbouncer')

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function bench(prepare: boolean) {
  const sql = postgres(u.toString(), { max: 6, prepare, ssl: { rejectUnauthorized: false }, idle_timeout: 30 })
  try {
    const [row] = await sql`select id from kia_bookings where deleted_at is null limit 1`
    const id = row.id as string

    // wave 1 = bookings.ts:980 (single booking read)
    // wave 2 = bookings.ts:991-1016 (Promise.all fan-out)
    const detail = async () => {
      const [b] = await sql`select * from kia_bookings where id = ${id} and deleted_at is null limit ${1}`
      await Promise.all([
        sql`select * from kia_vehicle_allocations where booking_id = ${id} and released_at is null limit ${1}`,
        sql`select id, activity_type, title, actor_name, created_at from kia_booking_activity where booking_id = ${id} order by created_at desc limit ${100}`,
        sql`select id, vin_number, from_dealer_code, to_dealer_code, transfer_status, created_at from kia_vehicle_transfers where booking_id = ${id} order by created_at desc limit ${50}`,
        b.proforma_id
          ? sql`select id, approval_status, created_at from kia_proformas where id = ${b.proforma_id} limit ${1}`
          : Promise.resolve([]),
        b.finance_order_id
          ? sql`select id, order_number, status, created_at from finance_orders where id = ${b.finance_order_id} limit ${1}`
          : Promise.resolve([]),
      ])
    }

    const t: number[] = []
    for (let i = 0; i < 12; i++) {
      const s = process.hrtime.bigint()
      await detail()
      t.push(Number(process.hrtime.bigint() - s) / 1e6)
    }
    const rtt = med(await (async () => {
      const r: number[] = []
      for (let i = 0; i < 5; i++) { const s = process.hrtime.bigint(); await sql`select 1`; r.push(Number(process.hrtime.bigint() - s) / 1e6) }
      return r
    })())

    const warm = med(t.slice(4))
    console.log(`\n=== getKiaBookingDetail replay | prepare:${prepare} ===`)
    console.log(`  RTT baseline   ${rtt.toFixed(1)}ms`)
    console.log(`  cold           ${t[0].toFixed(1)}ms`)
    console.log(`  WARM MEDIAN    ${warm.toFixed(1)}ms  (${(warm / rtt).toFixed(1)} RTT)`)
    console.log(`  series: ${t.map((x) => x.toFixed(0)).join(', ')}`)
    return warm
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main() {
  const off = await bench(false)
  const on = await bench(true)
  console.log(`\n>>> prepare:false ${off.toFixed(1)}ms -> prepare:true ${on.toFixed(1)}ms  = ${(off - on).toFixed(1)}ms saved (${(100 * (off - on) / off).toFixed(0)}%), ZERO SQL changes`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
