import 'dotenv/config'
import postgres from 'postgres'
let url = process.env.DATABASE_URL || process.env.ANALYTICS_DATABASE_URL
url = url.replace(':6543/', ':5432/').replace(/([?&])pgbouncer=true&?/, '$1').replace(/[?&]$/, '')
const db = postgres(url, { ssl:{rejectUnauthorized:false}, prepare:false, max:1, connect_timeout:20, idle_timeout:5 })
const q = async (t) => { const r = await db.unsafe(`SET statement_timeout TO '600000ms'; ${t}`); return r[1] || r }
const P = (c) => `RIGHT(regexp_replace(COALESCE(${c}, ''), '\D', '', 'g'), 10)`
const V = (c) => `${P(c)} ~ '^[6-9][0-9]{9}$'`
const N = `UPPER(regexp_replace(COALESCE(name_of_the_customer,''), '[^A-Za-z]', '', 'g'))`

console.log('=== J. Hyundai worst split phones — real customers or junk/desk lines? ===')
console.table(await q(`
WITH e AS (SELECT ${P('contact_number')} p, NULLIF(BTRIM(customer_id),'') cid, ${N} nm FROM hyundai_enquiry_report
           WHERE ${V('contact_number')} AND NULLIF(BTRIM(customer_id),'') IS NOT NULL)
SELECT p, COUNT(DISTINCT cid)::int ncid, COUNT(DISTINCT nm)::int nname, LEFT(string_agg(DISTINCT nm,' | '),60) names
FROM e GROUP BY p ORDER BY ncid DESC LIMIT 10`))

console.log('\n=== K. same-name splits by brand, EXCLUDING phones with >4 customer_ids (junk guard) ===')
for (const [b,t] of [['kia','kia_enquiry_report'],['hyundai','hyundai_enquiry_report'],['platinum','am_platinum_enquiry_report']]) {
  const r = (await q(`
  WITH e AS (SELECT ${P('contact_number')} p, NULLIF(BTRIM(customer_id),'') cid, ${N} nm FROM ${t}
             WHERE ${V('contact_number')} AND NULLIF(BTRIM(customer_id),'') IS NOT NULL),
  x AS (SELECT p, COUNT(DISTINCT cid)::int nc, COUNT(DISTINCT NULLIF(nm,''))::int nn FROM e GROUP BY p)
  SELECT COUNT(*) FILTER (WHERE nc>1)::int split_all,
         COUNT(*) FILTER (WHERE nc>1 AND nn=1)::int same_name,
         COUNT(*) FILTER (WHERE nc BETWEEN 2 AND 4 AND nn=1)::int same_name_le4,
         SUM(nc) FILTER (WHERE nc>1 AND nn=1)::int cids_to_union
  FROM x`))[0]
  console.log(`${b.padEnd(9)} split=${r.split_all}  sameName=${r.same_name}  sameName&<=4cids=${r.same_name_le4}  customer_ids needing union=${r.cids_to_union}`)
}

console.log('\n=== L. cross-brand: sample of exact-name matches (true dupes) vs name mismatches ===')
console.log('-- exact name match across KIA & Hyundai:')
console.table(await q(`
WITH A AS (SELECT ${P('contact_number')} p, ${N} nm FROM kia_enquiry_report WHERE ${V('contact_number')} AND LENGTH(${N})>=3),
     B AS (SELECT ${P('contact_number')} p, ${N} nm FROM hyundai_enquiry_report WHERE ${V('contact_number')} AND LENGTH(${N})>=3)
SELECT DISTINCT a.p, a.nm FROM A a JOIN B b ON b.p=a.p AND b.nm=a.nm LIMIT 5`))
console.log('-- SAME phone, DIFFERENT names across KIA & Hyundai (would be a false merge):')
console.table(await q(`
WITH A AS (SELECT ${P('contact_number')} p, ${N} nm FROM kia_enquiry_report WHERE ${V('contact_number')} AND LENGTH(${N})>=3),
     B AS (SELECT ${P('contact_number')} p, ${N} nm FROM hyundai_enquiry_report WHERE ${V('contact_number')} AND LENGTH(${N})>=3),
 g AS (SELECT a.p, string_agg(DISTINCT a.nm,'/') kn, string_agg(DISTINCT b.nm,'/') hn FROM A a JOIN B b ON b.p=a.p GROUP BY a.p)
SELECT p, LEFT(kn,28) kia_name, LEFT(hn,28) hyundai_name FROM g
WHERE LEFT(kn,4)<>LEFT(hn,4) AND kn NOT LIKE '%'||hn||'%' AND hn NOT LIKE '%'||kn||'%' LIMIT 6`))
await db.end()
