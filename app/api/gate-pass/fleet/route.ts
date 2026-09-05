import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess, visibleDealerCodes } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getFleetStatus } from '@/lib/gate-pass/fleet'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The demo fleet by availability: how many cars there are, how many are out, how many are free.
 *
 * ⚠️ Scoped to the caller's branches. A Udhampur user asking "how many demo cars are available"
 * means "here", and answering with the group total would send someone looking for a car 60 km away.
 */
export async function GET(_request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    return NextResponse.json(await getFleetStatus(visibleDealerCodes(access.appUser)))
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
