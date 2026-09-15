import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess, visibleDealerCodes } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getUnaccountedVehicles } from '@/lib/gate-pass/unaccounted'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Demo cars off the premises with no gate pass authorising it.
 *
 * ⚠️ GATED ON `gate_pass.approve`, NOT on `view`. The fleet board is deliberately open to every
 * authenticated employee (lib/gate-pass/access.ts:120-123) because "is a car free" is a harmless
 * question. This is not that question: every row is a precise location plus an implicit allegation
 * that somebody took a car without authorisation. The fleet route already redacts coordinates from
 * non-approvers for the same reason — this route has no unredacted form to fall back to, so it
 * refuses outright rather than serving a hollowed-out list that reads as "nothing to see".
 */
export async function GET(_request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.approve')
  if (access.denied) return access.denied

  try {
    return NextResponse.json(await getUnaccountedVehicles(visibleDealerCodes(access.appUser)))
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
