import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'
import {
  expireKiaTemporaryAllocations,
  expireKiaStockHolds,
  markKiaSoldAllocations,
  markKiaTransferMissing,
  startKiaArrivedAllocationCountdowns,
} from '@/lib/kia/bookings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cron endpoint: runs ALL KIA booking maintenance sweeps. Secret-gated (?secret=) so the scheduler
 * (or n8n / any external cron) can call it. Idempotent — safe to call as often as you like.
 *
 * These four sweeps used to run INSIDE user read requests (getKiaBookingDetail, getKiaBookingMatchingVehicles,
 * the proforma stock route), which put write transactions + full-table scans on the critical path of the
 * app's hottest endpoint and burned Vercel Fluid CPU on every view. Reads are now read-only; this job is
 * the single scheduled trigger. It calls the SAME functions the read path did, so behaviour is identical —
 * notably markKiaSoldAllocations() writes the `metadata.vehicleNotInStock` flag that drives the CRM
 * "NOT IN STOCK" badge/filter (the standalone scripts/kia-detect-sold-allocations.mjs does NOT).
 *
 * Run it at least every few minutes: allocation reservations (5 days / CSD 7 days) and unpaid dealer holds (48h)
 * only lapse when this runs.
 */
export async function POST(request: Request) {
  const url = new URL(request.url)

  // Was `if (secret && ...)`, which skipped the check whenever the env var was unset — so with no
  // KIA_MAINTENANCE_SECRET in production this endpoint ran write sweeps for any anonymous caller.
  // authorizeCronRequest fails closed instead.
  const auth = authorizeCronRequest(request, url, {
    secret: process.env.KIA_MAINTENANCE_SECRET,
    secretEnvName: 'KIA_MAINTENANCE_SECRET',
  })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const startedAt = Date.now()
  const result = {
    ok: true,
    countdownsStarted: 0,
    expiredAllocations: null as string | null,
    expiredHolds: 0,
    soldFlagged: 0,
    transferMissing: null as string | null,
    errors: [] as string[],
  }

  // Each sweep is independent — one failing must not stop the others.

  // Arrival BEFORE expiry: this opens payment windows for vehicles that have just reached Free
  // Stock. Order is not strictly required (a 'transferring' row has expires_at NULL and the expiry
  // sweep skips it either way), but opening windows first keeps the sequence readable.
  try {
    result.countdownsStarted = await startKiaArrivedAllocationCountdowns()
  } catch (error) {
    result.errors.push(`startKiaArrivedAllocationCountdowns: ${error instanceof Error ? error.message : 'failed'}`)
  }
  try {
    await expireKiaTemporaryAllocations()
    result.expiredAllocations = 'ok'
  } catch (error) {
    result.errors.push(`expireKiaTemporaryAllocations: ${error instanceof Error ? error.message : 'failed'}`)
  }
  try {
    result.expiredHolds = await expireKiaStockHolds()
  } catch (error) {
    result.errors.push(`expireKiaStockHolds: ${error instanceof Error ? error.message : 'failed'}`)
  }
  try {
    const sold = await markKiaSoldAllocations()
    result.soldFlagged = sold.length
  } catch (error) {
    result.errors.push(`markKiaSoldAllocations: ${error instanceof Error ? error.message : 'failed'}`)
  }
  try {
    await markKiaTransferMissing()
    result.transferMissing = 'ok'
  } catch (error) {
    result.errors.push(`markKiaTransferMissing: ${error instanceof Error ? error.message : 'failed'}`)
  }

  result.ok = result.errors.length === 0
  return NextResponse.json({ ...result, durationMs: Date.now() - startedAt }, { status: result.ok ? 200 : 500 })
}
