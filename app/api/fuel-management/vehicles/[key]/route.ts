import { NextResponse, type NextRequest } from 'next/server'
import { guardFuelManagement, NO_STORE, refuse } from '@/lib/fuel-management/api'
import { ledgerVehicle, vehicleRowFor } from '@/lib/fuel-management/ledger'
import { loadLedger, parseFuelFilters } from '@/lib/fuel-management/ledger-reads'
import type { FuelVehicleProfile } from '@/lib/fuel-management/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/fuel-management/vehicles/<key>?from&to — one vehicle's fuel profile: figures for the period, twelve
 * months of trend, every mileage stretch with its reason when unusable, fills, drives and exceptions.
 *
 * <key> is a VIN, or a consumer key the ledger produced (ASSET:…, LABEL:…), URL-encoded.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const guard = await guardFuelManagement()
  if (!guard.ok) return guard.response

  const { key: rawKey } = await context.params
  const key = decodeURIComponent(rawKey ?? '').trim().toUpperCase()
  if (!key || key.length > 200) return refuse(400, 'That vehicle reference is not valid.')

  const parsed = parseFuelFilters(request.nextUrl.searchParams)
  if (!parsed.ok) return refuse(400, parsed.error)

  try {
    const ledger = await loadLedger(parsed.filters.from, parsed.filters.to)
    const row = vehicleRowFor(ledger, key, parsed.filters)
    if (!row) return refuse(404, 'No fuel or drive is recorded for this vehicle in the last 13 months.')
    return NextResponse.json<FuelVehicleProfile>(ledgerVehicle(ledger, key, row), { headers: NO_STORE })
  } catch (error) {
    console.error('[fuel-management] vehicle profile failed for', key, error)
    return refuse(500, 'This vehicle could not be loaded just now. Please try again.')
  }
}
