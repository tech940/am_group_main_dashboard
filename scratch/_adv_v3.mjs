import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet:true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 30, idle_timeout: 20, max: 1, prepare: false })

for (const t of ['hyundai_ro_billing_report','am_platinum_ro_billing_report']) {
  console.log(`=== ${t} dealer codes ALL TIME ===`)
  console.log(JSON.stringify(await sql.unsafe(`
    select coalesce(source_dealer_code,'<NULL>') sdc, coalesce(dealer_code,'<NULL>') dc,
           coalesce(main_dealer_code,'<NULL>') mdc, count(*)::int n,
           min(bill_date)::text mn, max(bill_date)::text mx
    from ${t} group by 1,2,3 order by 4 desc limit 30`)))
  console.log(`=== ${t} AUG-2026 by sdc ===`)
  console.log(JSON.stringify(await sql.unsafe(`
    select coalesce(source_dealer_code,'<NULL>') sdc, count(*)::int n
    from ${t} where bill_date >= '2026-08-01' and bill_date <= '2026-08-28' group by 1 order by 2 desc`)))
}
await sql.end()
