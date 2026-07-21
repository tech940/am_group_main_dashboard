import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== AUDITING STOCK ROUTE STATUS QUERIES ===\n')

  // 1. Query metrics with status = AVAILABLE
  const metricsAvailable = await sql`
    SELECT
      COUNT(CASE WHEN NOT (va.id IS NOT NULL AND kb.status = 'delivered') THEN 1 END)::int AS total_vins,
      COUNT(CASE WHEN va.id IS NULL THEN 1 END)::int AS available,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') THEN 1 END)::int AS payment_pending,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW() THEN 1 END)::int AS payment_overdue,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'ready_delivery' THEN 1 END)::int AS paid_to_deliver,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'delivered' THEN 1 END)::int AS delivered,
      COUNT(CASE WHEN vt.id IS NOT NULL THEN 1 END)::int AS transfers
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
    WHERE TRUE AND NOT (va.id IS NOT NULL AND kb.status = 'delivered')
  `
  console.log('Metrics when status=AVAILABLE:', JSON.stringify(metricsAvailable[0]))

  // 2. Query metrics when status = PAYMENT_PENDING
  const metricsPending = await sql`
    SELECT
      COUNT(CASE WHEN NOT (va.id IS NOT NULL AND kb.status = 'delivered') THEN 1 END)::int AS total_vins,
      COUNT(CASE WHEN va.id IS NULL THEN 1 END)::int AS available,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') THEN 1 END)::int AS payment_pending,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW() THEN 1 END)::int AS payment_overdue,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'ready_delivery' THEN 1 END)::int AS paid_to_deliver,
      COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'delivered' THEN 1 END)::int AS delivered,
      COUNT(CASE WHEN vt.id IS NOT NULL THEN 1 END)::int AS transfers
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
    WHERE TRUE AND va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND NOT (va.id IS NOT NULL AND kb.status = 'delivered')
  `
  console.log('Metrics when status=PAYMENT_PENDING:', JSON.stringify(metricsPending[0]))

  // 3. Query rows when status = PAYMENT_PENDING
  const rowsPending = await sql`
    SELECT 
      sm.vin_number, sm.model, sm.variant, va.id as allocation_id, va.allocation_status, va.expires_at, kb.id as booking_id, kb.status as booking_status, kb.customer_name
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
    WHERE TRUE AND va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND NOT (va.id IS NOT NULL AND kb.status = 'delivered')
  `
  console.log(`\nRows returned when status=PAYMENT_PENDING (${rowsPending.length} rows):`, JSON.stringify(rowsPending, null, 2))

  // 4. Check if there are any allocations whose VIN is missing from kia_stock_management
  const noPaymentAllocations = await sql`
    SELECT va.id, va.vin_number, va.allocation_status, kb.status as booking_status
    FROM kia_vehicle_allocations va
    JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    WHERE va.released_at IS NULL AND va.allocation_status = 'no_payment' AND kb.status NOT IN ('delivered', 'cancelled')
  `
  console.log(`\nno_payment allocations:`, JSON.stringify(noPaymentAllocations, null, 2))

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
