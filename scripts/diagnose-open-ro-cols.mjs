import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[cols]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
const cols = await db.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='open_ro_yearly' ORDER BY ordinal_position`)
console.log('open_ro_yearly columns:', cols.map(c => c.column_name))

const openJun15 = await db.unsafe(`
  SELECT * FROM open_ro_yearly
  WHERE ro_date >= '2026-06-14'::date AND ro_date <= '2026-06-15'::date
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  LIMIT 20
`)
console.log('open accidental Jun 14-15 sample:', openJun15)

await db.end()
