import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getCachedData } from '@/lib/redis/cache-utils'

// Real counts for the home page's stock-yard row labels. One statement (scalar sub-selects), Redis-
// cached — the hero is decorative, so this must never become a meaningful DB load.
//
// Definitions deliberately mirror the app's own sections so the hero never contradicts them:
//  - newStock: the Stock Report's canonical "in stock" — kia_stock_management, minus vehicles whose
//    booking is delivered (active allocation join), minus VINs retailed directly in the DMS sales
//    feed (see lib/kia/stock-report.ts STOCK_SOURCE_* — the ~11% over-count fix).
//  - demoFleet: the Demo Cars List's population — distinct test-drive VINs in kia_demo_car_list.
//  - readyForDelivery: bookings holding a FINAL (allotted) active allocation, not yet delivered.
export type KiaYardStats = {
  newStock: number
  demoFleet: number
  readyForDelivery: number
}

const CACHE_KEY = 'kia:home:yard-stats:v1'
const CACHE_TTL_SECONDS = 5 * 60

export async function getKiaYardStats(): Promise<KiaYardStats> {
  return getCachedData<KiaYardStats>(CACHE_KEY, async () => {
    const result = await db.execute(sql`
      SELECT
        (
          SELECT count(*)::int
          FROM kia_stock_management sm
          LEFT JOIN kia_vehicle_allocations va
            ON va.vin_number = sm.vin_number AND va.released_at IS NULL
          LEFT JOIN kia_bookings kb
            ON kb.id = va.booking_id AND kb.deleted_at IS NULL
          WHERE NOT (va.id IS NOT NULL AND kb.status = 'delivered')
            AND NOT EXISTS (
              SELECT 1 FROM kia_sales_report sr
              WHERE UPPER(TRIM(sr.vin_number)) = UPPER(TRIM(sm.vin_number))
                AND sr.delivery_date IS NOT NULL
            )
        ) AS new_stock,
        (
          SELECT count(DISTINCT UPPER(TRIM(vin_no::text)))::int
          FROM kia_demo_car_list
          WHERE UPPER(TRIM(test_drive_vin::text)) = 'YES'
            AND NULLIF(TRIM(vin_no::text), '') IS NOT NULL
        ) AS demo_fleet,
        (
          SELECT count(*)::int
          FROM kia_bookings kb
          JOIN kia_vehicle_allocations va
            ON va.booking_id = kb.id AND va.released_at IS NULL AND va.allocation_status = 'final'
          WHERE kb.deleted_at IS NULL
            AND kb.status NOT IN ('delivered', 'cancelled')
        ) AS ready_for_delivery
    `)
    const row = (Array.isArray(result) ? result[0] : undefined) as Record<string, unknown> | undefined
    const num = (v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    return {
      newStock: num(row?.new_stock),
      demoFleet: num(row?.demo_fleet),
      readyForDelivery: num(row?.ready_for_delivery),
    }
  }, CACHE_TTL_SECONDS)
}
