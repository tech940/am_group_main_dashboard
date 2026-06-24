import 'dotenv/config'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
})

async function main() {
  const sampleNullDealer = await sql`
    SELECT *
    FROM hyundai_repair_order_list
    WHERE dealer IS NULL
    LIMIT 5
  `
  console.log('Sample rows where dealer is NULL:')
  console.log(JSON.stringify(sampleNullDealer, null, 2))

  const countByColumns = await sql`
    SELECT
      COUNT(*) AS total,
      COUNT(dealer) AS count_dealer,
      COUNT(dealer_code) AS count_dealer_code,
      COUNT(source_dealer_code) AS count_source_dealer_code,
      COUNT(dlr_no) AS count_dlr_no
    FROM hyundai_repair_order_list
  `
  console.log('\nColumn populate statistics:')
  console.log(JSON.stringify(countByColumns, null, 2))
}

main().catch(console.error).finally(() => sql.end())
