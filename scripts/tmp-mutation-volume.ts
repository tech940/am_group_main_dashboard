import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })

async function main() {
  // Volume of the three mutations the finding targets, bucketed by age.
  // allot -> kia_vehicle_allocations.allocated_at
  // transfer -> kia_vehicle_transfers.requested_at
  // hold -> kia_stock_local_statuses (local_status='hold_dealer')

  const allocs = await sql`
    SELECT
      count(*) FILTER (WHERE allocated_at > now() - interval '1 day')  AS d1,
      count(*) FILTER (WHERE allocated_at > now() - interval '7 days')  AS d7,
      count(*) FILTER (WHERE allocated_at > now() - interval '30 days') AS d30,
      count(*) AS total,
      min(allocated_at) AS earliest,
      max(allocated_at) AS latest
    FROM kia_vehicle_allocations
  `
  console.log('kia_vehicle_allocations (allot):', allocs[0])

  const transfers = await sql`
    SELECT
      count(*) FILTER (WHERE requested_at > now() - interval '1 day')  AS d1,
      count(*) FILTER (WHERE requested_at > now() - interval '7 days')  AS d7,
      count(*) FILTER (WHERE requested_at > now() - interval '30 days') AS d30,
      count(*) AS total,
      min(requested_at) AS earliest,
      max(requested_at) AS latest
    FROM kia_vehicle_transfers
  `
  console.log('kia_vehicle_transfers (transfer):', transfers[0])

  const holds = await sql`
    SELECT local_status, count(*) AS n, min(updated_at) AS earliest, max(updated_at) AS latest
    FROM kia_stock_local_statuses
    GROUP BY local_status
    ORDER BY n DESC
  `
  console.log('kia_stock_local_statuses by local_status:', holds)

  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
