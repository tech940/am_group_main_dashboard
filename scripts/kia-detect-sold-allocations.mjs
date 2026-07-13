// Flags allotted KIA vehicles whose VIN has DISAPPEARED from the DMS stock feed (kia_stock_management)
// as "sold", writes a booking-activity row, and notifies the sales person + dealer managers + oversight.
// Idempotent (stock_missing_at guard + notification dedupe). Intended to run after each DMS load
// (wire into the existing DMS ingest / n8n) or on the interval scheduler sibling.
//
// The app also self-heals lazily on booking-detail views (lib/kia/bookings.ts maybeSweepSoldAllocations),
// but this script is the reliable, feed-driven trigger. Both share dedupeKey 'sold:<allocationId>'.
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
      ),
      recipients AS (
        SELECT s.allocation_id, s.vin_number, s.booking_id, s.dealer_code, s.booking_number, s.customer_name, s.model, u.id AS user_id, u.role AS user_role
        FROM sold s JOIN users u ON u.id = s.created_by AND u.is_active = true AND u.deleted_at IS NULL
        UNION
        SELECT s.allocation_id, s.vin_number, s.booking_id, s.dealer_code, s.booking_number, s.customer_name, s.model, u.id, u.role
        FROM sold s JOIN users u ON u.role IN ('sales_manager', 'general_manager', 'md') AND u.is_active = true AND u.deleted_at IS NULL AND (u.brand IN ('kia', 'all') OR u.brand IS NULL)
        UNION
        SELECT s.allocation_id, s.vin_number, s.booking_id, s.dealer_code, s.booking_number, s.customer_name, s.model, u.id, u.role
        FROM sold s JOIN users u ON u.role IN ('developer', 'admin') AND u.is_active = true AND u.deleted_at IS NULL
      ),
      notify AS (
        INSERT INTO notifications (user_id, title, message, type, action_url, entity_type, entity_id, reference_number, target_role, dedupe_key, metadata, created_at)
        SELECT user_id,
               'Allotted vehicle sold / missing from stock',
               'Allotted vehicle no longer in DMS stock (likely sold) · ' || customer_name || ' · ' || booking_number || COALESCE(' (' || model || ')', '') || ' · VIN ' || vin_number,
               'warning',
               '/brands/kia/bookings?bookingId=' || booking_id,
               'kia_sold_vehicle', booking_id, booking_number, user_role, 'sold:' || allocation_id,
               jsonb_build_object('module', 'kia_bookings', 'event', 'stock_missing', 'allocationId', allocation_id, 'bookingId', booking_id, 'vinNumber', vin_number, 'model', model, 'dealerCode', dealer_code),
               now()
        FROM recipients
        ON CONFLICT (user_id, dedupe_key) DO NOTHING
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
