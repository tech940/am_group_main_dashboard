import 'dotenv/config'
import postgres from 'postgres'
let url = process.env.DATABASE_URL || process.env.ANALYTICS_DATABASE_URL
url = url.replace(':6543/', ':5432/').replace(/([?&])pgbouncer=true&?/, '$1').replace(/[?&]$/, '')
const db = postgres(url, { ssl:{rejectUnauthorized:false}, prepare:false, max:1, connect_timeout:20, idle_timeout:5 })
const q = async (t) => { const r = await db.unsafe(`SET statement_timeout TO '600000ms'; ${t}`); return r[1] || r }
const P = (c) => `RIGHT(regexp_replace(COALESCE(${c}, ''), '\D', '', 'g'), 10)`
const V = (c) => `${P(c)} ~ '^[6-9][0-9]{9}$'`
const N = `UPPER(regexp_replace(COALESCE(name_of_the_customer,''), '[^A-Za-z]', '', 'g'))`

console.log('=== G. do Hyundai / Platinum ALSO have a populated party key, and does it split? ===')
for (const [b,t] of [['kia','kia_enquiry_report'],['hyundai','hyundai_enquiry_report'],['platinum','am_platinum_enquiry_report']]) {
  const f = (await q(`SELECT COUNT(*)::int rows, COUNT(*) FILTER (WHERE NULLIF(BTRIM(customer_id),'') IS NOT NULL)::int filled,
    LEFT(string_agg(DISTINCT NULLIF(BTRIM(customer_id),''),','),70) AS sample FROM (SELECT customer_id FROM ${t} LIMIT 400) s`))[0]
  const g = (await q(`
    WITH e AS (SELECT ${P('contact_number')} p, NULLIF(BTRIM(customer_id),'') cid, ${N} nm FROM ${t}
               WHERE ${V('contact_number')} AND NULLIF(BTRIM(customer_id),'') IS NOT NULL),
    x AS (SELECT p, COUNT(DISTINCT cid)::int nc, COUNT(DISTINCT NULLIF(nm,''))::int nn FROM e GROUP BY p)
    SELECT COUNT(*)::int phones, COUNT(*) FILTER (WHERE nc>1)::int split,
           COUNT(*) FILTER (WHERE nc>1 AND nn=1)::int split_one_name, MAX(nc)::int worst FROM x`))[0]
  console.log(`${b.padEnd(9)} customer_id filled ${f.filled}/${f.rows} of sample | sample=${(f.sample||'').slice(0,45)}`)
  console.log(`          phones=${g.phones} split=${g.split} (${(100*g.split/g.phones).toFixed(1)}%) sameName=${g.split_one_name} worst=${g.worst}`)
}

console.log('\n=== H. are cross-brand overlap phones just high-volume desk lines? ===')
const h = await q(`
WITH k AS (SELECT ${P('contact_number')} p, COUNT(*)::int c FROM kia_enquiry_report WHERE ${V('contact_number')} GROUP BY 1),
     hy AS (SELECT DISTINCT ${P('contact_number')} p FROM hyundai_enquiry_report WHERE ${V('contact_number')}),
     pl AS (SELECT DISTINCT ${P('contact_number')} p FROM am_platinum_enquiry_report WHERE ${V('contact_number')})
SELECT (k.p IN (SELECT p FROM hy) OR k.p IN (SELECT p FROM pl)) AS overlaps,
       COUNT(*)::int phones, ROUND(AVG(c),2) avg_kia_rows, MAX(c)::int max_kia_rows
FROM k GROUP BY 1`)
console.table(h)

console.log('\n=== I. distinct names per overlapping phone ACROSS all 3 brands ===')
const i = await q(`
WITH u AS (
  SELECT ${P('contact_number')} p, ${N} nm, 'k' b FROM kia_enquiry_report WHERE ${V('contact_number')} AND LENGTH(${N})>=3
  UNION ALL SELECT ${P('contact_number')}, ${N}, 'h' FROM hyundai_enquiry_report WHERE ${V('contact_number')} AND LENGTH(${N})>=3
  UNION ALL SELECT ${P('contact_number')}, ${N}, 'p' FROM am_platinum_enquiry_report WHERE ${V('contact_number')} AND LENGTH(${N})>=3),
g AS (SELECT p, COUNT(DISTINCT b)::int nb, COUNT(DISTINCT nm)::int nn FROM u GROUP BY p)
SELECT nb AS brands_seen, COUNT(*)::int phones,
  COUNT(*) FILTER (WHERE nn=1)::int one_name,
  COUNT(*) FILTER (WHERE nn>=3)::int three_plus_names
FROM g WHERE nb>1 GROUP BY nb ORDER BY nb`)
console.table(i)
await db.end()
