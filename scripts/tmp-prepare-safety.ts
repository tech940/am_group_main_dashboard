import 'dotenv/config'
import postgres from 'postgres'

// READ-ONLY. Only SELECTs.
const u = new URL(process.env.DATABASE_URL!)
u.port = '6543' // production transaction pooler
u.searchParams.delete('pgbouncer')

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function main() {
  // Mirror production: max:6 (lib/db/index.ts:7 DEFAULT_POOL_MAX), prepare:true
  const sql = postgres(u.toString(), {
    max: 6,
    prepare: true,
    ssl: { rejectUnauthorized: false },
    idle_timeout: 10,
    connection: { application_name: 'tmp_prepare_probe' },
  })

  let errors = 0
  const onErr = (e: any) => { errors++; console.log('  ERROR:', e.code, e.routine, e.message?.slice(0, 90)) }

  try {
    const [row] = await sql`select id from kia_bookings where deleted_at is null limit 1`
    const id = row.id as string

    // ---- concurrent fan-out mirroring getKiaBookingDetail's Promise.all (bookings.ts:991-1016)
    const wave = () => Promise.all([
      sql`select * from kia_bookings where id = ${id} and deleted_at is null limit ${1}`.catch(onErr),
      sql`select id from kia_vehicle_allocations where booking_id = ${id} and released_at is null limit ${1}`.catch(onErr),
      sql`select id, activity_type, title from kia_booking_activity where booking_id = ${id} order by created_at desc limit ${100}`.catch(onErr),
      sql`select id, vin_number from kia_vehicle_transfers where booking_id = ${id} order by created_at desc limit ${50}`.catch(onErr),
      sql`select id, approval_status from kia_proformas limit ${1}`.catch(onErr),
    ])

    const times: number[] = []
    for (let i = 0; i < 10; i++) {
      const t = process.hrtime.bigint()
      await wave()
      times.push(Number(process.hrtime.bigint() - t) / 1e6)
    }
    console.log('\n=== 6543 TRANSACTION pooler, max:6, prepare:true ===')
    console.log('  concurrent 5-query wave series:', times.map((x) => x.toFixed(0)).join(', '))
    console.log('  cold wave', times[0].toFixed(1) + 'ms | warm-med', med(times.slice(3)).toFixed(1) + 'ms')
    console.log('  errors:', errors)

    // ---- many DISTINCT shapes: does the per-connection statement cache misbehave / leak?
    let shapeErr = 0
    for (let i = 0; i < 60; i++) {
      await sql.unsafe(`select count(*)::int as c from kia_bookings where deleted_at is null and $1::int = ${i}`, [i])
        .catch((e: any) => { shapeErr++; console.log('  SHAPE ERROR:', e.code, e.routine) })
    }
    console.log('  60 distinct statement shapes -> errors:', shapeErr)

    // how many prepared statements are actually pinned server-side right now?
    const ps = await sql`select count(*)::int as c from pg_prepared_statements`
    console.log('  pg_prepared_statements visible on this backend:', ps[0].c)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
