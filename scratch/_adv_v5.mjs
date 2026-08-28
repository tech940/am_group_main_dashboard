import postgres from 'postgres'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet: true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 30, idle_timeout: 20, max: 1, prepare: false })
const q = fs.readFileSync('C:/Users/sahil/Downloads/am_group_main_dashboard/scratch/_adv_prop.sql', 'utf8')
for (const anchor of ['2026-08-26', '2026-08-28', '2026-08-01']) {
  const t0 = Date.now()
  const r = await sql.unsafe(q, [anchor])
  console.log(`### anchor=${anchor}  (${Date.now() - t0} ms, ${r.length} rows)`)
  for (const row of r) console.log(JSON.stringify(row))
}
await sql.end()
