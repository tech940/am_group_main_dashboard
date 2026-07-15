// Flags allotted KIA vehicles whose VIN has DISAPPEARED from the DMS stock feed (kia_stock_management)
// as "sold" and writes a booking-activity row. Idempotent (stock_missing_at guard). Intended to run
// after each DMS load (wire into the existing DMS ingest / n8n) or on the interval scheduler sibling.
//
// The app also self-heals lazily on booking-detail views (lib/kia/bookings.ts maybeSweepSoldAllocations),
// but this script is the reliable, feed-driven trigger.
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    // 0. #12 Auto-release dealer holds unpaid past their 48h window — the VIN returns to matchable
    //    stock (row deleted), exactly like an unpaid temporary allocation. 'PAID' holds are kept.
    const releasedHolds = await sql.unsafe(`
      DELETE FROM kia_stock_local_statuses
      WHERE local_status IN ('hold_dealer', 'hold_customer')
        AND coalesce(stock_status_at_mark, '') <> 'PAID'
        AND marked_at IS NOT NULL
        AND marked_at + interval '48 hours' <= now()
      RETURNING vin_number
    `)
    if (releasedHolds.length) console.log(`[hold-expiry] released ${releasedHolds.length} unpaid hold(s) back to stock.`)

    // 1. Refresh "last seen in stock" for active allocations whose VIN is currently present. A VIN
    //    must have been seen at least once before it can be marked missing.
    await sql.unsafe(`
      UPDATE kia_vehicle_allocations va
      SET stock_last_seen_at = now(), updated_at = now()
      WHERE va.released_at IS NULL
        AND EXISTS (SELECT 1 FROM kia_stock_management sm WHERE upper(trim(sm.vin_number)) = upper(trim(va.vin_number)))
    `)

    // 2. Freshness gate: never mass-flag when the DMS table is empty (a failed / partial load).
    const gate = await sql.unsafe(`SELECT count(*)::int AS stock_count FROM kia_stock_management`)
    if (!Number(gate[0]?.stock_count)) {
      console.log('[sold-detect] DMS stock table is empty — skipping (freshness gate).')
      return
    }

    // 3. Mark sold + write activity + notify recipients — one statement, all-or-nothing.
    const marked = await sql.unsafe(`
      WITH sold AS (
        UPDATE kia_vehicle_allocations va
        SET stock_missing_at = now(), stock_status = 'sold', updated_at = now()
        FROM kia_bookings kb
        WHERE va.booking_id = kb.id
          AND va.released_at IS NULL
          AND va.stock_missing_at IS NULL
          AND va.stock_last_seen_at IS NOT NULL
          AND kb.deleted_at IS NULL
          AND kb.status NOT IN ('delivered', 'cancelled')
          AND NOT EXISTS (SELECT 1 FROM kia_stock_management sm WHERE upper(trim(sm.vin_number)) = upper(trim(va.vin_number)))
        RETURNING va.id AS allocation_id, va.vin_number, va.booking_id, va.dealer_code,
                  kb.booking_number, kb.customer_name, kb.model, kb.created_by
      ),
      activity AS (
        INSERT INTO kia_booking_activity (booking_id, activity_type, title, description, actor_name, actor_role, after_value)
        SELECT booking_id, 'stock_missing', 'Allotted vehicle no longer in DMS stock',
               'VIN ' || vin_number || ' disappeared from DMS stock — likely sold',
               'System', 'system',
               jsonb_build_object('vinNumber', vin_number, 'reason', 'absent from kia_stock_management')
        FROM sold
      )
      SELECT allocation_id, vin_number, booking_number FROM sold
    `)

    console.log(`[sold-detect] flagged ${marked.length} allotted vehicle(s) as sold/missing from DMS.`)
    for (const row of marked) console.log(`  - ${row.booking_number} · VIN ${row.vin_number}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('kia-detect-sold-allocations failed:', error); process.exit(1) })
