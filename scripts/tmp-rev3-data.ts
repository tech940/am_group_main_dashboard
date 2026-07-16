import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

async function main() {
  const fanout = await sql`
    SELECT
      count(*)                                                                        AS live_bookings,
      count(*) FILTER (WHERE proforma_id IS NOT NULL)                                 AS has_proforma,
      count(*) FILTER (WHERE finance_order_id IS NOT NULL)                            AS has_finance,
      count(*) FILTER (WHERE proforma_id IS NOT NULL AND finance_order_id IS NOT NULL) AS has_both,
      count(*) FILTER (WHERE proforma_id IS NULL AND finance_order_id IS NULL)         AS has_neither
    FROM kia_bookings WHERE deleted_at IS NULL`
  console.log('--- wave-2 fan-out distribution (per booking) ---')
  console.log(fanout[0])

  const tbl = await sql`
    SELECT c.relname AS tname, s.n_live_tup AS tup,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS total
    FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid
    WHERE c.relname IN ('kia_vehicle_allocations','kia_vehicle_transfers','kia_booking_activity','kia_bookings','kia_proformas','finance_orders')
    ORDER BY c.relname`
  console.log('\n--- tables touched by the detail wave ---')
  console.table(tbl.map((r) => ({ table: r.tname, live_tup: r.tup, total: r.total })))

  // How many activity rows does the busiest booking actually have (the limit-100 select)?
  const act = await sql`
    SELECT count(*) AS n FROM kia_booking_activity
    GROUP BY booking_id ORDER BY n DESC LIMIT 1`
  console.log('max activity rows on any single booking:', act[0]?.n ?? 0)

  // Server-side pooler limits — is 6 even the binding constraint?
  const lim = await sql`SELECT current_setting('max_connections') AS max_conn`
  console.log('server max_connections:', lim[0].max_conn)

  await sql.end()
}
main()
