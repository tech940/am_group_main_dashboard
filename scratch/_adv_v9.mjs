import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet: true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 60, idle_timeout: 20, max: 1, prepare: false })

console.log('--- daily raw rows, last 12 days per feed ---')
for (const t of ['hyundai_ro_billing_report','am_platinum_ro_billing_report','kia_ro_billing_report']) {
  const r = await sql.unsafe(`select bill_date::text d, count(*)::int n from ${t} where bill_date >= '2026-08-15' group by 1 order by 1`)
  console.log(t, r.map(x=>`${x.d.slice(8)}:${x.n}`).join(' '))
}
console.log('--- discount consistency: rows with dis_amt>0, does total = labour+part+tax+roundoff? ---')
for (const t of ['hyundai_ro_billing_report','am_platinum_ro_billing_report','kia_ro_billing_report']) {
  const r = await sql.unsafe(`
    select count(*)::int n_disc,
      count(*) filter (where abs(total_amt - (coalesce(labour_amt,0)+coalesce(part_amt,0)+coalesce(labour_tax,0)+coalesce(part_tax,0)+coalesce(nullif(regexp_replace(round_off::text,'[^0-9.-]','','g'),''),'0')::numeric)) < 0.5)::int n_ok,
      sum(dis_amt)::float disc_total
    from ${t} where bill_date between '2026-08-01' and '2026-08-28' and coalesce(dis_amt,0) > 0`)
  console.log(t, JSON.stringify(r[0]))
}
console.log('--- HY: any source_dealer_code NULL/blank/ACTIVE ever? ---')
console.log(JSON.stringify((await sql`select count(*) filter (where source_dealer_code is null or btrim(source_dealer_code)='')::int blanks, count(*) filter (where upper(btrim(source_dealer_code))='ACTIVE')::int active from hyundai_ro_billing_report`)[0]))
console.log(JSON.stringify((await sql`select count(*) filter (where source_dealer_code is null or btrim(source_dealer_code)='')::int blanks, count(*) filter (where upper(btrim(source_dealer_code))='ACTIVE')::int active from am_platinum_ro_billing_report`)[0]))
console.log('--- KIA dealer_code_2 blank pct ---')
console.log(JSON.stringify((await sql`select count(*) filter (where dealer_code_2 is null or btrim(dealer_code_2)='')::int blank, count(*)::int total from kia_ro_billing_report`)[0]))
await sql.end()
