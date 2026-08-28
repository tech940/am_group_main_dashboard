import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet: true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 60, idle_timeout: 20, max: 1, prepare: false })
const j = (x) => console.log(JSON.stringify(x))

console.log('=== today / tz ===')
j(await sql`select now() as utc, (now() at time zone 'Asia/Kolkata')::date as ist_today, current_setting('TimeZone') tz`)

console.log('=== hyundai_sales_report dealer codes (all time) ===')
j(await sql`select coalesce(nullif(btrim(dealer_code),''),'(null)') dc, coalesce(nullif(btrim(dealer_code_2),''),'(null)') dc2, coalesce(nullif(btrim(source_dealer_code),''),'(null)') sdc, count(*)::int n from hyundai_sales_report group by 1,2,3 order by 4 desc limit 30`)

console.log('=== platinum_sales_report dealer codes (all time) ===')
j(await sql`select coalesce(nullif(btrim(dealer_code),''),'(null)') dc, coalesce(nullif(btrim(dealer_code_2),''),'(null)') dc2, coalesce(nullif(btrim(source_dealer_code),''),'(null)') sdc, count(*)::int n from am_platinum_sales_report group by 1,2,3 order by 4 desc limit 30`)

console.log('=== KIA outlets across 3 feeds (all time) ===')
for (const [t, mc] of [['kia_sales_report','main_dealer_code'],['kia_booking_report','main_dealer'],['kia_enquiry_report','main_dealer_code']]) {
  j({t, rows: await sql.unsafe(`select upper(btrim(coalesce(nullif(btrim(dealer_code_2),''), nullif(btrim(dealer_code),''), nullif(btrim(${mc}),'')))) outlet, count(*)::int n from ${t} group by 1 order by 2 desc`)})
}

console.log('=== platinum booking dealer codes by month ===')
j(await sql`select to_char(booking_date,'YYYY-MM') m, coalesce(nullif(btrim(dealer_code),''),'(null)') dc, count(*)::int n from am_platinum_booking_report group by 1,2 order by 1 desc limit 20`)

console.log('=== hyundai booking dealer codes ===')
j(await sql`select coalesce(nullif(btrim(dealer_code),''),'(null)') dc, count(*)::int n, min(booking_date)::text mn, max(booking_date)::text mx from hyundai_booking_report group by 1 order by 2 desc`)

console.log('=== blank customer_id counts (hyundai family) ===')
for (const t of ['hyundai_booking_report','hyundai_enquiry_report','am_platinum_booking_report','am_platinum_enquiry_report']) {
  j({t, r: (await sql.unsafe(`select count(*) filter (where coalesce(btrim(customer_id),'')='')::int blanks, count(*)::int total from ${t}`))[0]})
}
await sql.end()
