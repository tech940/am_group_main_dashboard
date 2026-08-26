import 'dotenv/config'
import postgres from 'postgres'

let url = process.env.DATABASE_URL || process.env.ANALYTICS_DATABASE_URL
url = url.replace(':6543/', ':5432/').replace(/([?&])pgbouncer=true&?/, '$1').replace(/[?&]$/, '')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 })

const q = async (text) => { const r = await db.unsafe(`SET statement_timeout TO '240000ms'; ${text}`); return r[1] || r }

// STEP 0: which enquiry-ish tables exist, and which carry a phone + an identity column?
const cols = await q(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public'
    AND (table_name ILIKE '%enquiry%' OR table_name ILIKE '%booking%' OR table_name ILIKE '%sales_report%')
  ORDER BY table_name, ordinal_position
`)
const byTable = new Map()
for (const c of cols) { if (!byTable.has(c.table_name)) byTable.set(c.table_name, []); byTable.get(c.table_name).push(c.column_name) }
console.log('=== candidate tables: phone-ish + id-ish columns ===')
for (const [t, cs] of byTable) {
  const phone = cs.filter(c => /phone|mobile|contact|cell/i.test(c))
  const ident = cs.filter(c => /customer_?id|cust_?id|customerid|party/i.test(c))
  if (phone.length || ident.length) console.log(`${t.padEnd(40)} phone=[${phone}] ident=[${ident}]`)
}
await db.end()
