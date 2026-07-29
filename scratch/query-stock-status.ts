import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  console.log('=== STOCK COUNT DIAGNOSTICS ===\n')

  const deliveredExpr = "((va.id IS NOT NULL AND kb.status = 'delivered') OR COALESCE(ls.local_status, '') = 'retail')"

  // Let's run the exact KPI metric queries as defined in the API route
  const metricsResult = await sql`
    SELECT
      COUNT(CASE WHEN NOT (((va.id IS NOT NULL AND kb.status = 'delivered') OR COALESCE(ls.local_status, '') = 'retail')) THEN 1 END)::int AS total_vins,
      COUNT(
        CASE WHEN va.id IS NULL
              AND vt.id IS NULL
              AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail')
              AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED')
        THEN 1 END
      )::int AS available,
      COUNT(CASE WHEN (va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered')) OR (UPPER(COALESCE(sm.stock_status, '')) = 'ALLOCATED' AND va.id IS NULL AND vt.id IS NULL) THEN 1 END)::int AS payment_pending,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW() THEN 1 END)::int AS payment_overdue,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'ready_delivery' THEN 1 END)::int AS paid_to_deliver,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'delivered' THEN 1 END)::int AS delivered,
      COUNT(CASE WHEN vt.id IS NOT NULL THEN 1 END)::int AS transfers
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
  `
  console.log('Calculated KPI Metrics:')
  console.log(JSON.stringify(metricsResult[0], null, 2))

  // Find the exact rows that are counted in total_vins but not in any of the categories
  const anomalies = await sql`
    SELECT 
      sm.vin_number, 
      sm.stock_status, 
      ls.local_status,
      va.id as allocation_id,
      kb.status as booking_status,
      vt.id as transfer_id
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
    WHERE 
      -- Not delivered (so counted in total_vins)
      NOT (((va.id IS NOT NULL AND kb.status = 'delivered') OR COALESCE(ls.local_status, '') = 'retail'))
      -- AND NOT in any of the other categories
      AND NOT (
        -- AVAILABLE
        (va.id IS NULL AND vt.id IS NULL AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail') AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED'))
        -- PAYMENT_PENDING
        OR ((va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered')) OR (UPPER(COALESCE(sm.stock_status, '')) = 'ALLOCATED' AND va.id IS NULL AND vt.id IS NULL))
        -- PAID_TO_DELIVER
        OR (va.id IS NOT NULL AND kb.status = 'ready_delivery')
        -- DELIVERED (though excluded from total_vins, let's keep it here)
        OR (va.id IS NOT NULL AND kb.status = 'delivered')
        -- TRANSFERS
        OR (vt.id IS NOT NULL)
      )
  `
  console.log(`\nAnomalous Rows (counted in total_vins but not in any KPI bucket) - Count: ${anomalies.length}`)
  console.log(JSON.stringify(anomalies, null, 2))

  await sql.end()
}

main().catch(console.error)
