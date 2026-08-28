import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet: true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 60, idle_timeout: 20, max: 1, prepare: false })

const tables = ['hyundai_sales_report','hyundai_booking_report','hyundai_enquiry_report',
 'am_platinum_sales_report','am_platinum_booking_report','am_platinum_enquiry_report',
 'kia_sales_report','kia_booking_report','kia_enquiry_report']

console.log('=== EXISTENCE ===')
console.log(JSON.stringify(await sql`select c.relname, c.reltuples::bigint est from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any(${tables})`))

console.log('=== COLUMNS OF INTEREST ===')
const cols = await sql`
 select table_name, column_name, data_type
 from information_schema.columns
 where table_schema='public' and table_name = any(${tables})
   and column_name in ('id','uploaded_at','row_hash','delivery_date','invoice_date','confirm_date','booking_date','enquiry_date','vin_number','vin_no','dealer_code','dealer_code_2','main_dealer','main_dealer_code','customer_id','customerid','model','booking_no','enquiry_no','invoice_no','status','source_dealer_code','ex_showroom_price')
 order by table_name, column_name`
const byT = {}
for (const r of cols) { (byT[r.table_name] ||= []).push(`${r.column_name}:${r.data_type}`) }
for (const t of tables) console.log(t, '->', (byT[t]||['MISSING']).join(', '))
await sql.end()
