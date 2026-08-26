import 'dotenv/config'
import postgres from 'postgres'
let url = process.env.DATABASE_URL || process.env.ANALYTICS_DATABASE_URL
url = url.replace(':6543/', ':5432/').replace(/([?&])pgbouncer=true&?/, '$1').replace(/[?&]$/, '')
const db = postgres(url, { ssl:{rejectUnauthorized:false}, prepare:false, max:1, connect_timeout:20, idle_timeout:5 })
const q = async (t) => { const r = await db.unsafe(`SET statement_timeout TO '600000ms'; ${t}`); return r[1] || r }
const P = (c) => `RIGHT(regexp_replace(COALESCE(${c}, ''), '\D', '', 'g'), 10)`
const V = (c) => `${P(c)} ~ '^[6-9][0-9]{9}$'`

const setSql = (t) => `SELECT DISTINCT ${P('contact_number')} AS p FROM ${t} WHERE ${V('contact_number')}`

console.log('=== B. cross-brand overlaps (distinct valid phone10) ===')
const r = (await q(`
WITH k AS (${setSql('kia_enquiry_report')}),
     h AS (${setSql('hyundai_enquiry_report')}),
     p AS (${setSql('am_platinum_enquiry_report')})
SELECT
 (SELECT COUNT(*) FROM k)::int kn,(SELECT COUNT(*) FROM h)::int hn,(SELECT COUNT(*) FROM p)::int pn,
 (SELECT COUNT(*) FROM k JOIN h USING(p))::int kh,
 (SELECT COUNT(*) FROM k JOIN p USING(p))::int kp,
 (SELECT COUNT(*) FROM h JOIN p USING(p))::int hp,
 (SELECT COUNT(*) FROM k JOIN h USING(p) JOIN p USING(p))::int khp,
 (SELECT COUNT(*) FROM k WHERE p IN (SELECT p FROM h UNION SELECT p FROM p))::int k_any
`))[0]
console.log(r)
console.log(`KIA∩Hyundai  ${r.kh}  = ${(100*r.kh/r.kn).toFixed(1)}% of KIA`)
console.log(`KIA∩Platinum ${r.kp}  = ${(100*r.kp/r.kn).toFixed(1)}% of KIA`)
console.log(`Hyu∩Platinum ${r.hp}  = ${(100*r.hp/r.pn).toFixed(1)}% of Platinum`)
console.log(`all three    ${r.khp}`)
console.log(`KIA in ANY other brand ${r.k_any} = ${(100*r.k_any/r.kn).toFixed(1)}% of KIA`)

console.log('\n=== C. WITHIN KIA: one valid phone10 -> many customer_id ===')
const c = await q(`
WITH e AS (
  SELECT ${P('contact_number')} AS p, NULLIF(BTRIM(customer_id),'') AS cid
  FROM kia_enquiry_report WHERE ${V('contact_number')} AND NULLIF(BTRIM(customer_id),'') IS NOT NULL
), g AS (SELECT p, COUNT(DISTINCT cid)::int n FROM e GROUP BY p)
SELECT COUNT(*)::int total_phones_with_cid,
       COUNT(*) FILTER (WHERE n>1)::int split_phones,
       MAX(n)::int worst,
       SUM(n) FILTER (WHERE n>1)::int cids_in_split
FROM g`)
console.log(c[0])
const dist = await q(`
WITH e AS (SELECT ${P('contact_number')} AS p, NULLIF(BTRIM(customer_id),'') AS cid FROM kia_enquiry_report WHERE ${V('contact_number')} AND NULLIF(BTRIM(customer_id),'') IS NOT NULL),
g AS (SELECT p, COUNT(DISTINCT cid)::int n FROM e GROUP BY p)
SELECT n, COUNT(*)::int phones FROM g WHERE n>1 GROUP BY n ORDER BY n`)
console.table(dist)
await db.end()
