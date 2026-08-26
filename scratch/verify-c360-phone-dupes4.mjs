import 'dotenv/config'
import postgres from 'postgres'
let url = process.env.DATABASE_URL || process.env.ANALYTICS_DATABASE_URL
url = url.replace(':6543/', ':5432/').replace(/([?&])pgbouncer=true&?/, '$1').replace(/[?&]$/, '')
const db = postgres(url, { ssl:{rejectUnauthorized:false}, prepare:false, max:1, connect_timeout:20, idle_timeout:5 })
const q = async (t) => { const r = await db.unsafe(`SET statement_timeout TO '600000ms'; ${t}`); return r[1] || r }
const P = (c) => `RIGHT(regexp_replace(COALESCE(${c}, ''), '\D', '', 'g'), 10)`
const V = (c) => `${P(c)} ~ '^[6-9][0-9]{9}$'`
// letters-only name normalisation, exactly as phone-match.ts ambiguity CTE
const N = `UPPER(regexp_replace(COALESCE(name_of_the_customer,''), '[^A-Za-z]', '', 'g'))`

const feed = (t,b) => `SELECT ${P('contact_number')} AS p, ${N} AS nm, '${b}' AS brand FROM ${t} WHERE ${V('contact_number')} AND LENGTH(${N})>=3`

console.log('=== D. KIA∩Hyundai overlap: do the NAMES agree? ===')
for (const [label, a, an, b, bn] of [
  ['KIA vs HYUNDAI','kia_enquiry_report','kia','hyundai_enquiry_report','hyundai'],
  ['KIA vs PLATINUM','kia_enquiry_report','kia','am_platinum_enquiry_report','platinum'],
  ['HYUNDAI vs PLATINUM','hyundai_enquiry_report','hyundai','am_platinum_enquiry_report','platinum'],
]) {
  const r = (await q(`
  WITH A AS (${feed(a,an)}), B AS (${feed(b,bn)}),
  ov AS (SELECT DISTINCT a.p FROM A a JOIN B b ON b.p=a.p),
  j AS (
    SELECT o.p,
      bool_or(a.nm = b.nm) AS exact,
      bool_or(a.nm LIKE '%'||b.nm||'%' OR b.nm LIKE '%'||a.nm||'%') AS contains,
      bool_or(LEFT(a.nm,4)=LEFT(b.nm,4)) AS pref4
    FROM ov o JOIN A a ON a.p=o.p JOIN B b ON b.p=o.p GROUP BY o.p)
  SELECT COUNT(*)::int overlap_named,
    COUNT(*) FILTER (WHERE exact)::int exact_name,
    COUNT(*) FILTER (WHERE contains)::int substring_name,
    COUNT(*) FILTER (WHERE pref4)::int prefix4
  FROM j`))[0]
  console.log(`${label.padEnd(22)} overlapWithNames=${r.overlap_named}  exactName=${r.exact_name} (${(100*r.exact_name/r.overlap_named).toFixed(1)}%)  substr=${r.substring_name} (${(100*r.substring_name/r.overlap_named).toFixed(1)}%)  prefix4=${r.prefix4} (${(100*r.prefix4/r.overlap_named).toFixed(1)}%)`)
}

console.log('\n=== E. WITHIN KIA 337 splits: same person or different people? ===')
const e = (await q(`
WITH e AS (SELECT ${P('contact_number')} AS p, NULLIF(BTRIM(customer_id),'') AS cid, ${N} AS nm
           FROM kia_enquiry_report WHERE ${V('contact_number')} AND NULLIF(BTRIM(customer_id),'') IS NOT NULL),
g AS (SELECT p, COUNT(DISTINCT cid)::int ncid, COUNT(DISTINCT NULLIF(nm,''))::int nname FROM e GROUP BY p)
SELECT COUNT(*) FILTER (WHERE ncid>1)::int split,
       COUNT(*) FILTER (WHERE ncid>1 AND nname=1)::int same_name_split,
       COUNT(*) FILTER (WHERE ncid>1 AND nname>1)::int diff_name_split
FROM g`))[0]
console.log(e)
console.log(`--> of ${e.split} phones with >1 customer_id, ${e.same_name_split} (${(100*e.same_name_split/e.split).toFixed(1)}%) carry ONE name (true split of one person)`) 
console.log(`--> ${e.diff_name_split} (${(100*e.diff_name_split/e.split).toFixed(1)}%) carry >1 name (household/shared line — correctly separate people)`)

console.log('\n=== F. worst offenders (top phones by distinct customer_id) ===')
console.table(await q(`
WITH e AS (SELECT ${P('contact_number')} AS p, NULLIF(BTRIM(customer_id),'') AS cid, ${N} AS nm
           FROM kia_enquiry_report WHERE ${V('contact_number')} AND NULLIF(BTRIM(customer_id),'') IS NOT NULL)
SELECT p, COUNT(DISTINCT cid)::int ncid, COUNT(DISTINCT nm)::int nname, LEFT(string_agg(DISTINCT nm,' | '),90) names
FROM e GROUP BY p ORDER BY ncid DESC LIMIT 8`))
await db.end()
