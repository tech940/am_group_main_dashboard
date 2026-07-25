import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function testStockQuery(statusFilter: string) {
  console.log(`\n--- Testing Stock Query with status: '${statusFilter}' ---`)

  const deliveredExpr = "(va.id IS NOT NULL AND kb.status = 'delivered')"
  const filters: string[] = ['TRUE']

  if (statusFilter !== 'All') {
    if (statusFilter === 'AVAILABLE') {
      filters.push("va.id IS NULL AND vt.id IS NULL AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail') AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED')")
    } else if (statusFilter === 'ALLOTTED' || statusFilter === 'PAYMENT_PENDING') {
      filters.push("va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered')")
    } else if (statusFilter === 'PAYMENT_OVERDUE') {
      filters.push("va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW()")
    } else if (statusFilter === 'PAID_TO_DELIVER') {
      filters.push("va.id IS NOT NULL AND kb.status = 'ready_delivery'")
    } else if (statusFilter === 'DELIVERED') {
      filters.push("va.id IS NOT NULL AND kb.status = 'delivered'")
    } else if (statusFilter === 'TRANSFERRED') {
      filters.push("vt.id IS NOT NULL")
    }
  }

  if (statusFilter !== 'DELIVERED') {
    filters.push(`NOT ${deliveredExpr}`)
  }

  const whereClause = filters.join(' AND ')

  try {
    const totalCountResult = await db.execute(sql.raw(`
      SELECT COUNT(*)::int as count
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE ${whereClause}
    `))
    console.log(`[PASS] Count for status '${statusFilter}':`, totalCountResult[0]?.count)
  } catch (err) {
    console.error(`[FAIL] SQL Error for status '${statusFilter}':`, err)
  }
}

async function runAll() {
  for (const s of ['All', 'AVAILABLE', 'PAYMENT_PENDING', 'PAID_TO_DELIVER', 'DELIVERED', 'TRANSFERRED']) {
    await testStockQuery(s)
  }
}

runAll().catch(console.error).finally(() => process.exit(0))
