import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet:true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 30, idle_timeout: 20, max: 1, prepare: false })

const vd = await sql`select pg_get_viewdef('public.kia_ro_billing_report'::regclass, true) as def`
console.log('VIEWDEF:', vd[0].def)

for (const t of ['kia_ro_billing_report','ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report']) {
  const r = await sql.unsafe(`select count(*)::int n, min(bill_date)::text mn, max(bill_date)::text mx, max(uploaded_at)::text up from ${t}`)
  console.log(t, JSON.stringify(r[0]))
}

console.log('--- work_type all-time ---')
for (const t of ['kia_ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report']) {
  const r = await sql.unsafe(`select coalesce(work_type,'<NULL>') wt, count(*)::int n from ${t} group by 1 order by 2 desc`)
  console.log(t, JSON.stringify(r))
}
console.log('--- bill_type all-time ---')
for (const t of ['kia_ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report']) {
  const r = await sql.unsafe(`select coalesce(bill_type,'<NULL>') bt, count(*)::int n from ${t} group by 1 order by 2 desc limit 40`)
  console.log(t, JSON.stringify(r))
}
console.log('--- kia bill_status ---')
console.log(JSON.stringify(await sql`select coalesce(bill_status,'<NULL>') bs, count(*)::int n from kia_ro_billing_report group by 1 order by 2 desc`))
console.log('--- kia dealer split ---')
console.log(JSON.stringify(await sql`select coalesce(dealer_code,'<NULL>') dc, coalesce(main_dealer_code,'<NULL>') mdc, coalesce(dealer_code_2,'<NULL>') dc2, count(*)::int n from kia_ro_billing_report group by 1,2,3 order by 4 desc limit 20`))
await sql.end()
