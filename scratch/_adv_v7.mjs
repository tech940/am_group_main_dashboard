import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet: true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 60, idle_timeout: 20, max: 1, prepare: false })

console.log('--- Platinum N6828 vs N6848 overlap on (bill_no,bill_date) ---')
console.log(JSON.stringify(await sql`
  select count(*)::int pairs from am_platinum_ro_billing_report a
  join am_platinum_ro_billing_report b on a.bill_no=b.bill_no and a.bill_date=b.bill_date
  where a.source_dealer_code='N6828' and b.source_dealer_code='N6848'`))
console.log('--- Platinum monthly rows by code 2026 ---')
console.log(JSON.stringify(await sql`
  select to_char(bill_date,'YYYY-MM') m, source_dealer_code c, count(*)::int n
  from am_platinum_ro_billing_report where bill_date >= '2026-01-01' and source_dealer_code in ('N6828','N6848')
  group by 1,2 order by 1,2`))
console.log('--- Platinum N6828/N6848 sample ---')
console.log(JSON.stringify(await sql`select source_dealer_code, bill_no, bill_date::text, vin from am_platinum_ro_billing_report where source_dealer_code in ('N6828','N6848') and bill_date between '2026-07-01' and '2026-07-07' order by bill_date, source_dealer_code limit 12`))

console.log('--- KIA Cancel by year ---')
console.log(JSON.stringify(await sql`select to_char(bill_date,'YYYY') y, count(*)::int n from kia_ro_billing_report where lower(trim(coalesce(bill_status,''))) in ('cancel','cancelled','canceled') group by 1 order by 1`))
console.log('--- KIA Aug-2026 active rows by work_type ---')
console.log(JSON.stringify(await sql`select work_type, count(*)::int n, sum(coalesce(labour_amt,0)+coalesce(part_amt,0))::float net from kia_ro_billing_report where bill_date between '2026-08-01' and '2026-08-28' and lower(trim(coalesce(bill_status,''))) not in ('cancel','cancelled','canceled') group by 1 order by 2 desc`))
console.log('--- KIA all-time NVI / TestDrive / Accessories net ---')
console.log(JSON.stringify(await sql`select work_type, count(*)::int n, sum(coalesce(labour_amt,0)+coalesce(part_amt,0))::float net from kia_ro_billing_report where work_type in ('NVI','Test Drive/CC Maintenance','Accessories') group by 1`))

console.log('--- JK501 first/last bill_date + monthly presence 2025 ---')
console.log(JSON.stringify(await sql`select min(bill_date)::text mn, max(bill_date)::text mx, count(*)::int n from kia_ro_billing_report where dealer_code='JK501'`))
console.log(JSON.stringify(await sql`select to_char(bill_date,'YYYY-MM') m, count(*)::int n from kia_ro_billing_report where dealer_code='JK501' group by 1 order by 1 limit 12`))

console.log('--- bill_date nulls ---')
for (const t of ['kia_ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report']) {
  console.log(t, JSON.stringify((await sql.unsafe(`select count(*) filter (where bill_date is null)::int nulls, count(*)::int total from ${t}`))[0]))
}
console.log('--- indexes ---')
console.log(JSON.stringify(await sql`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ('ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report') order by 1,2`, null, 1))
await sql.end()
