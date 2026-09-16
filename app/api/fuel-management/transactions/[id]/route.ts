import { NextResponse, type NextRequest } from 'next/server'
import { guardFuelManagement, NO_STORE, refuse } from '@/lib/fuel-management/api'
import { ledgerTransaction, vehicleRowFor } from '@/lib/fuel-management/ledger'
import { loadLedger, parseFuelFilters } from '@/lib/fuel-management/ledger-reads'
import type { FuelTransactionDetail } from '@/lib/fuel-management/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/fuel-management/transactions/<id>?from&to — one fuel record traced end to end: request, approval,
 * pump meter, bill, drives since the previous fill, GPS, and the mileage and cost analysis.
 *
 * The period only decides which cached ledger to read (and what "previous fill" can see); the record is found
 * by id within it.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardFuelManagement()
  if (!guard.ok) return guard.response

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return refuse(400, 'That fuel record reference is not valid.')

  const parsed = parseFuelFilters(request.nextUrl.searchParams)
  if (!parsed.ok) return refuse(400, parsed.error)

  try {
    const ledger = await loadLedger(parsed.filters.from, parsed.filters.to)
    const event = ledger.events.find((e) => e.id === id)
    if (!event) return refuse(404, 'This fuel record is outside the period on screen, or no longer exists.')
    const vehicle = event.identity === 'label' ? null : vehicleRowFor(ledger, event.vehicleKey, parsed.filters)
    const detail = ledgerTransaction(ledger, id, vehicle)
    if (!detail) return refuse(404, 'This fuel record no longer exists.')
    return NextResponse.json<FuelTransactionDetail>(detail, { headers: NO_STORE })
  } catch (error) {
    console.error('[fuel-management] transaction detail failed for', id, error)
    return refuse(500, 'This fuel record could not be loaded just now. Please try again.')
  }
}
