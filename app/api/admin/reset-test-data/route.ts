import { NextResponse } from 'next/server'
import { count, eq } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import {
  adminAuditLogs,
  kiaBookingActivity,
  kiaBookings,
  kiaCallbackRequests,
  kiaStockLocalStatuses,
  kiaVehicleAllocations,
  kiaVehicleTransfers,
} from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

// Only a super admin may reset test data.
async function authorizeSuperAdmin() {
  const actor = await getAuthenticatedAppUser()
  const capabilities = actor ? getAdminCapabilities(actor) : null
  if (!actor || !capabilities || capabilities.authority !== 'developer') return null
  return actor
}

async function currentCounts() {
  const [bookings, activity, allocations, transfers, retail] = await Promise.all([
    db.select({ c: count() }).from(kiaBookings),
    db.select({ c: count() }).from(kiaBookingActivity),
    db.select({ c: count() }).from(kiaVehicleAllocations),
    db.select({ c: count() }).from(kiaVehicleTransfers),
    db.select({ c: count() }).from(kiaStockLocalStatuses).where(eq(kiaStockLocalStatuses.localStatus, 'retail')),
  ])
  return {
    bookings: Number(bookings[0]?.c || 0),
    activity: Number(activity[0]?.c || 0),
    allocations: Number(allocations[0]?.c || 0),
    transfers: Number(transfers[0]?.c || 0),
    retailMarks: Number(retail[0]?.c || 0),
  }
}

// Preview what a reset would remove.
export async function GET() {
  const actor = await authorizeSuperAdmin()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ counts: await currentCounts() })
  } catch (error) {
    console.error('GET /api/admin/reset-test-data failed:', error)
    return NextResponse.json({ error: 'Failed to load counts.' }, { status: 500 })
  }
}

// Wipe test bookings + their children and the 'retail' stock markers created while
// testing, returning allotted/sold vehicles to available stock. Proformas, users,
// permissions and real inventory (kia_stock_management/report) are NOT touched.
export async function POST() {
  const actor = await authorizeSuperAdmin()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const before = await currentCounts()

    await db.transaction(async (tx) => {
      await tx.delete(kiaBookingActivity)
      await tx.delete(kiaVehicleTransfers)
      // ⚠️ THIS IS THE ONLY THING IN THE APP THAT CAN ERASE THE VEHICLE ALLOCATION HISTORY
      // (/brands/kia/allocation-history). That trail is meant to be permanent — nothing else deletes
      // from kia_vehicle_allocations, the allocate/release paths only INSERT and UPDATE. Running this
      // against production wipes every allocation audit record along with the bookings. The count is
      // captured in `before` and written to admin_audit_logs below, so a wipe is at least evidenced.
      await tx.delete(kiaVehicleAllocations)
      // Callback requests are a FK child of kia_bookings — must be cleared before the bookings.
      await tx.delete(kiaCallbackRequests)
      await tx.delete(kiaBookings)
      await tx.delete(kiaStockLocalStatuses).where(eq(kiaStockLocalStatuses.localStatus, 'retail'))

      await tx.insert(adminAuditLogs).values({
        actorUserId: actor.id,
        action: 'kia_reset_test_data',
        branch: actor.brand || null,
        reason: 'Wiped test bookings, allocations, transfers and retail stock markers',
        afterValue: before as unknown as Record<string, unknown>,
      })
    })

    return NextResponse.json({ ok: true, removed: before, counts: await currentCounts() })
  } catch (error) {
    console.error('POST /api/admin/reset-test-data failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to reset test data.' }, { status: 500 })
  }
}
