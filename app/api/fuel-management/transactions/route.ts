import { NextResponse, type NextRequest } from 'next/server'
import { guardFuelManagement, NO_STORE, refuse } from '@/lib/fuel-management/api'
import { listLedgerEvents, type LedgerEventQuery } from '@/lib/fuel-management/ledger'
import { loadLedger, parseFuelFilters } from '@/lib/fuel-management/ledger-reads'
import type { FuelLifecycle, FuelQualityKey, FuelTransactionsResponse } from '@/lib/fuel-management/types'

export const dynamic = 'force-dynamic'

const STATES = new Set<string>(['in_review', 'on_hold', 'sent_back', 'rejected', 'to_finalise', 'completed', 'open_exceptions'])
const QUALITY = new Set<string>([
  'vehicle_unidentified', 'odometer_missing', 'odometer_unreadable', 'full_tank_missing',
  'actual_missing', 'cost_missing', 'pass_missing', 'gps_missing',
])
const SORTS = new Set<string>(['date', 'quantity', 'cost', 'variance'])

/**
 * GET /api/fuel-management/transactions — the fuel record list, filtered, sorted and paginated on the server.
 * Same filters as the overview, plus state, quality, q (search), sort, direction, page, pageSize.
 */
export async function GET(request: NextRequest) {
  const guard = await guardFuelManagement()
  if (!guard.ok) return guard.response

  const params = request.nextUrl.searchParams
  const parsed = parseFuelFilters(params)
  if (!parsed.ok) return refuse(400, parsed.error)

  const state = String(params.get('state') ?? '')
  const quality = String(params.get('quality') ?? '')
  const sort = String(params.get('sort') ?? 'date')
  const query: LedgerEventQuery = {
    state: STATES.has(state) ? (state as FuelLifecycle | 'open_exceptions') : null,
    quality: QUALITY.has(quality) ? (quality as FuelQualityKey) : null,
    q: (params.get('q') ?? '').slice(0, 80) || null,
    sort: SORTS.has(sort) ? (sort as LedgerEventQuery['sort']) : 'date',
    direction: params.get('direction') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1),
    pageSize: Number.parseInt(params.get('pageSize') ?? '25', 10) || 25,
  }

  try {
    const ledger = await loadLedger(parsed.filters.from, parsed.filters.to)
    return NextResponse.json<FuelTransactionsResponse>(listLedgerEvents(ledger, parsed.filters, query), { headers: NO_STORE })
  } catch (error) {
    console.error('[fuel-management] transactions failed for', parsed.filters, error)
    return refuse(500, 'Fuel records could not be loaded just now. Please try again in a minute.')
  }
}
