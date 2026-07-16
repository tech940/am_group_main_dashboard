import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

async function main() {
  const dist = await sql`
    SELECT
      count(*) FILTER (WHERE deleted_at IS NULL) AS live,
      count(*) FILTER (WHERE deleted_at IS NULL AND proforma_id IS NOT NULL) AS has_proforma,
      count(*) FILTER (WHERE deleted_at IS NULL AND finance_order_id IS NOT NULL) AS has_finance,
      count(*) FILTER (WHERE deleted_at IS NULL AND proforma_id IS NOT NULL AND finance_order_id IS NOT NULL) AS has_both,
      count(*) FILTER (WHERE deleted_at IS NULL AND proforma_id IS NULL AND finance_order_id IS NULL) AS has_neither
    FROM kia_bookings
  `
  console.log('booking fan-out drivers:', dist[0])

  const alloc = await sql`SELECT count(*) AS n FROM kia_vehicle_allocations`
  const transfers = await sql`SELECT count(*) AS n FROM kia_vehicle_transfers`
  const activity = await sql`SELECT count(*) AS n FROM kia_booking_activity`
  console.log('kia_vehicle_allocations rows:', alloc[0].n)
  console.log('kia_vehicle_transfers rows:', transfers[0].n)
  console.log('kia_booking_activity rows:', activity[0].n)

  const perBooking = await sql`
    SELECT max(c) AS max_activity, avg(c)::numeric(10,2) AS avg_activity
    FROM (SELECT booking_id, count(*) AS c FROM kia_booking_activity GROUP BY booking_id) t
  `
  console.log('activity per booking:', perBooking[0])

  await sql.end()
}
main()
