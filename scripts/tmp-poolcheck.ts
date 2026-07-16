import 'dotenv/config'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL!
const med = (a:number[]) => a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)]

async function main() {
  const sql = postgres(URL, { max: 1, prepare: false, ssl:{rejectUnauthorized:false} })
  const rows = await sql`
    select count(*)::int total,
           count(proforma_id)::int with_proforma,
           count(finance_order_id)::int with_finance
    from kia_bookings where deleted_at is null`
  console.log('kia_bookings fan-out drivers:', rows[0])
  const t = await sql`select count(*)::int c from kia_vehicle_transfers`
  const a = await sql`select count(*)::int c from kia_vehicle_allocations`
  const act = await sql`select count(*)::int c, count(distinct booking_id)::int b from kia_booking_activity`
  console.log('kia_vehicle_transfers rows:', t[0].c, '| kia_vehicle_allocations rows:', a[0].c)
  console.log('kia_booking_activity rows:', act[0].c, 'across bookings:', act[0].b)
  // Per-booking actual wave-2 fan-out distribution
  const dist = await sql`
    select (3 + (proforma_id is not null)::int + (finance_order_id is not null)::int) fanout,
           count(*)::int n
    from kia_bookings where deleted_at is null group by 1 order by 1`
  console.log('ACTUAL wave-2 fan-out distribution:', dist)
  await sql.end()
}
main()
