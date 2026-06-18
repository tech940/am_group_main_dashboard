import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const result = await db.execute(sql`
    SELECT id, r_o_no, status, ro_date::text, work_type
    FROM open_ro_yearly
    WHERE r_o_no IN ('R202601764', 'R202601612')
  `)
  console.log(result)
}

main().catch(console.error)
