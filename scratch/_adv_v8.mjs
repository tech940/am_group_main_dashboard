import postgres from 'postgres'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet: true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 60, idle_timeout: 20, max: 1, prepare: false })

console.log('--- HY: does N5216 duplicate the other branches? (bill_no,bill_date) overlap 2026 ---')
console.log(JSON.stringify(await sql`
  select b.source_dealer_code other, count(*)::int pairs
  from hyundai_ro_billing_report a
  join hyundai_ro_billing_report b on a.bill_no=b.bill_no and a.bill_date=b.bill_date
  where a.source_dealer_code='N5216' and b.source_dealer_code <> 'N5216' and a.bill_date >= '2026-01-01'
  group by 1 order by 2 desc`))
console.log('--- HY monthly rows per code 2026 ---')
console.log(JSON.stringify(await sql`
  select to_char(bill_date,'YYYY-MM') m, source_dealer_code c, count(*)::int n
  from hyundai_ro_billing_report where bill_date >= '2026-06-01' group by 1,2 order by 1,2`))
console.log('--- HY indexes ---')
console.log(JSON.stringify((await sql`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='hyundai_ro_billing_report'`).map(r=>r.indexname+' :: '+r.indexdef.replace(/\s+/g,' ').slice(0,220)), null, 1))

console.log('--- KIA Aug deduped-active (no category filter) count ---')
console.log(JSON.stringify(await sql`
  WITH raw AS (SELECT COALESCE(NULLIF(bill_no,''),NULLIF(ro_no,''),id::text) jc,
    UPPER(BTRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,'')))) cc,
    COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),''),'0')::numeric la,
    COALESCE(NULLIF(regexp_replace(part_amt::text,'[^0-9.-]','','g'),''),'0')::numeric pa,
    bill_date, uploaded_at, id FROM kia_ro_billing_report
    WHERE bill_date between '2026-08-01' and '2026-08-28'
      AND LOWER(TRIM(COALESCE(bill_status,''))) NOT IN ('cancel','cancelled','canceled')),
  r2 AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY cc, jc ORDER BY ABS(la+pa) DESC, bill_date DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM raw)
  SELECT COUNT(*)::int deduped_all, SUM(la+pa)::float net FROM r2 WHERE rn=1`))

const q = fs.readFileSync('C:/Users/sahil/Downloads/am_group_main_dashboard/scratch/_adv_prop.sql','utf8')
for (const anchor of ['2025-12-15','2025-11-10']) {
  const r = await sql.unsafe(q, [anchor])
  console.log(`### anchor=${anchor} -> ${r.length} rows: ${r.map(x=>x.company).join(' | ')}`)
}

console.log('--- EXPLAIN (proposed, anchor 2026-08-26) ---')
const ex = await sql.unsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' + q.replace(/\$1/g, `'2026-08-26'`).replace(/;\s*$/,''))
console.log(ex.map(r => r['QUERY PLAN']).join('\n'))
await sql.end()
