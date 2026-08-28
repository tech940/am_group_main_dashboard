import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env' })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 30, idle_timeout: 20, max: 1, prepare: false })

const rk = await sql`
  select c.relname, c.relkind::text as relkind
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('kia_ro_billing_report','ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report')
  order by 1`
console.log('RELKIND:', JSON.stringify(rk))

for (const t of ['kia_ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report']) {
  const r = await sql`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=${t} order by ordinal_position`
  console.log(`=== ${t} (${r.length} cols) ===`)
  console.log(r.map(x=>`${x.column_name}:${x.data_type}`).join(' | '))
}
await sql.end()
