import 'dotenv/config'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
})

async function main() {
  const roStatuses = await sql`
    SELECT r_o_status, COUNT(*) AS count
    FROM hyundai_repair_order_list
    GROUP BY r_o_status
    ORDER BY count DESC
  `
  console.log('r_o_status values:')
  console.log(JSON.stringify(roStatuses, null, 2))

  const statuses = await sql`
    SELECT status, COUNT(*) AS count
    FROM hyundai_repair_order_list
    GROUP BY status
    ORDER BY count DESC
  `
  console.log('\nstatus values:')
  console.log(JSON.stringify(statuses, null, 2))

  const newStatuses = await sql`
    SELECT new_r_o_status, COUNT(*) AS count
    FROM hyundai_repair_order_list
    GROUP BY new_r_o_status
    ORDER BY count DESC
  `
  console.log('\nnew_r_o_status values:')
  console.log(JSON.stringify(newStatuses, null, 2))
}

main().catch(console.error).finally(() => sql.end())
