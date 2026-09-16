import { NextResponse, type NextRequest } from 'next/server'
import { guardFuelManagement, NO_STORE, refuse } from '@/lib/fuel-management/api'
import { summariseLedger } from '@/lib/fuel-management/ledger'
import { loadLedger, parseFuelFilters } from '@/lib/fuel-management/ledger-reads'
import type { FuelManagementResponse } from '@/lib/fuel-management/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/fuel-management?from&to&branch&brand&purpose&department&energy&fleet&vehicle
 *
 * The control centre's overview: headline figures with the previous period, what needs attention, recent activity,
 * breakdowns, the trend, vehicles, exceptions and data quality — all aggregated on the server from one cached
 * ledger. The browser never receives the underlying rows; the record list is paginated at /transactions.
 *
 * ⚠️ Access is canViewFuelManagement — the SAME predicate app/fuel-management/page.tsx calls (via
 * guardFuelManagement). Driver messages are logged, never returned.
 */
export async function GET(request: NextRequest) {
  const guard = await guardFuelManagement()
  if (!guard.ok) return guard.response

  const parsed = parseFuelFilters(request.nextUrl.searchParams)
  if (!parsed.ok) return refuse(400, parsed.error)

  try {
    const ledger = await loadLedger(parsed.filters.from, parsed.filters.to)
    return NextResponse.json<FuelManagementResponse>(summariseLedger(ledger, parsed.filters), { headers: NO_STORE })
  } catch (error) {
    console.error('[fuel-management] overview failed for', parsed.filters, error)
    return refuse(500, 'Fuel figures could not be loaded just now. Please try again in a minute.')
  }
}
