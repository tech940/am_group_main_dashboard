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
    const fleet = await getFleetStatus(visibleDealerCodes(access.appUser))

    /*
     * ⚠️ COORDINATES ARE NOT FOR EVERYONE. requireGatePassAccess deliberately lets EVERY
     * authenticated employee through for 'view' (access.ts:120-123) — the fleet board is meant to be
     * open, so anyone can see whether a car is free. Live GPS is a different thing: a demo car that
     * is out is usually being driven by a named customer or a colleague, so a precise position is
     * personal data about that person, not just an asset status.
     *
     * So: everyone keeps the STATE (is it tracked, is the fix live or stale, how old) — which is what
     * makes the board honest about coverage — and only an approver gets lat/lng/address.
     *
     * This is a read-time redaction, unlike lib/gate-pass/events.ts which redacts at WRITE time. The
     * difference is deliberate: an audit snapshot is written once and read for ever, so filtering it
     * on read is one forgotten call site away from a leak. A position is re-derived on every request
     * from a row the sync owns, and the approver genuinely needs the coordinate the requester must
     * not see, so the same value cannot simply be dropped at write time.
     */
    const canSeeCoordinates = !(await requireGatePassAccess('gate_pass.approve')).denied
    if (!canSeeCoordinates) {
      fleet.vehicles = fleet.vehicles.map((v) => ({
        ...v,
        tracking: { ...v.tracking, latitude: null, longitude: null, address: null, providerVehicleUuid: null },
      }))
    }

    return NextResponse.json(fleet)
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
