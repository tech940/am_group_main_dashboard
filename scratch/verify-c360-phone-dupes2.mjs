import 'dotenv/config'
import postgres from 'postgres'
let url = process.env.DATABASE_URL || process.env.ANALYTICS_DATABASE_URL
url = url.replace(':6543/', ':5432/').replace(/([?&])pgbouncer=true&?/, '$1').replace(/[?&]$/, '')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 })
const q = async (t) => { const r = await db.unsafe(`SET statement_timeout TO '600000ms'; ${t}`); return r[1] || r }

// phone10 exactly as lib/customer-identity/phone-match.ts + lookupKey validity
const P = (c) => `RIGHT(regexp_replace(COALESCE(${c}, ''), '\D', '', 'g'), 10)`
const DUMMY = `('0000000000','1111111111','2222222222','3333333333','4444444444','5555555555','6666666666','7777777777','8888888888','9999999999','1234567890','9876543210','9000000000','1234512345')`

const feeds = {
  kia: 'kia_enquiry_report',
  hyundai: 'hyundai_enquiry_report',
  platinum: 'am_platinum_enquiry_report',
}

console.log('=== A. raw rows + distinct phone10 under three validity definitions ===')
for (const [b, t] of Object.entries(feeds)) {
  const r = (await q(`
    SELECT COUNT(*)::int AS rows,
      COUNT(DISTINCT NULLIF(${P('contact_number')},''))::int AS d_any10,
      COUNT(DISTINCT CASE WHEN ${P('contact_number')} ~ '^[6-9][0-9]{9}$' THEN ${P('contact_number')} END)::int AS d_mobile,
      COUNT(DISTINCT CASE WHEN ${P('contact_number')} ~ '^[6-9][0-9]{9}$' AND ${P('contact_number')} NOT IN ${DUMMY} THEN ${P('contact_number')} END)::int AS d_lookupkey,
      COUNT(DISTINCT NULLIF(BTRIM(customer_id),''))::int AS d_custid
    FROM ${t}`))[0]
  console.log(`${b.padEnd(9)} rows=${String(r.rows).padStart(7)}  any10=${String(r.d_any10).padStart(7)}  mobile[6-9]=${String(r.d_mobile).padStart(7)}  lookupKey=${String(r.d_lookupkey).padStart(7)}  distinct customer_id=${String(r.d_custid).padStart(7)}`)
}
await db.end()
