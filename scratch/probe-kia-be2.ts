import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const gap = rows(await analyticsDb.execute(sql`
    SELECT COUNT(*) FILTER (WHERE COALESCE(BTRIM(dealer_code_2),'') = '') AS dc2_empty,
           COUNT(*) FILTER (WHERE COALESCE(BTRIM(dealer_code),'') = '')   AS dc_empty,
           COUNT(*) AS total,
           MIN(bill_date) FILTER (WHERE COALESCE(BTRIM(dealer_code_2),'') <> '')::text AS dc2_starts
    FROM ro_billing_report`))
  console.log('dealer_code_2 coverage:', JSON.stringify(gap[0]))

  const vals = rows(await analyticsDb.execute(sql`
    SELECT COALESCE(NULLIF(BTRIM(dealer_code),''),'(blank)') AS dc, COUNT(*) AS n
    FROM ro_billing_report GROUP BY 1 ORDER BY 2 DESC LIMIT 6`))
  console.log('dealer_code values:', vals.map((v) => `${v.dc}=${v.n}`).join(' | '))

  const vals2 = rows(await analyticsDb.execute(sql`
    SELECT COALESCE(NULLIF(BTRIM(dealer_code_2),''),'(blank)') AS dc2, COUNT(*) AS n
    FROM ro_billing_report GROUP BY 1 ORDER BY 2 DESC LIMIT 6`))
  console.log('dealer_code_2 values:', vals2.map((v) => `${v.dc2}=${v.n}`).join(' | '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
