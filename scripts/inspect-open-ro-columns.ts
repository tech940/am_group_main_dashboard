import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db'

async function main() {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(dealer) AS count_dealer,
      COUNT(source_dealer_code) AS count_source_dealer_code,
      COUNT(dealer_code) AS count_dealer_code,
      COUNT(dlr_no) AS count_dlr_no
    FROM hyundai_repair_order_list
  `)
  console.log('Column counts:', result)

  const sampleNullDealer = await db.execute(sql`
    SELECT id, dealer, source_dealer_code, dealer_code, dlr_no, r_o_no, r_o_status, status, new_r_o_status
    FROM hyundai_repair_order_list
    WHERE dealer IS NULL
    LIMIT 5
  `)
  console.log('Sample rows where dealer is NULL:', sampleNullDealer)

  const statusCounts = await db.execute(sql`
    SELECT
      COALESCE(r_o_status, 'NULL') AS ro_status,
      COUNT(*) AS count
    FROM hyundai_repair_order_list
    GROUP BY COALESCE(r_o_status, 'NULL')
    ORDER BY count DESC
  `)
  console.log('r_o_status counts:', statusCounts)

  const newStatusCounts = await db.execute(sql`
    SELECT
      COALESCE(new_r_o_status, 'NULL') AS new_ro_status,
      COUNT(*) AS count
    FROM hyundai_repair_order_list
    GROUP BY COALESCE(new_r_o_status, 'NULL')
    ORDER BY count DESC
    LIMIT 10
  `)
  console.log('new_r_o_status counts (top 10):', newStatusCounts)
}

main().catch(console.error).finally(() => process.exit(0))
