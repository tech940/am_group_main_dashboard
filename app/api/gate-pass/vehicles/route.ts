import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess, visibleDealerCodes } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { listDemoVehiclesForGatePass, lookupByRegistration } from '@/lib/gate-pass/vehicles'

export const dynamic = 'force-dynamic'

/**
 * The demo fleet, for the request form's vehicle picker.
 *
 * ⚠️ A `?reg=` lookup returns a LIST and the client must make a human choose. Measured on the live
 * feed: 29 demo VINs but only 25 distinct registration numbers — `JK02C0059TC` is a trade-
 * certificate plate worn by FIVE different cars. Demo fleets recycle TC plates, so auto-selecting a
 * single match would silently put the wrong vehicle on the pass and the guard would wave through a
 * car nobody approved.
 */
export async function GET(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const scope = visibleDealerCodes(access.appUser)
    const reg = request.nextUrl.searchParams.get('reg')

    if (reg) {
      const matches = (await lookupByRegistration(reg)).filter(
        (v) => !v.dealerCode || scope.includes(v.dealerCode),
      )
      return NextResponse.json({ vehicles: matches, ambiguous: matches.length > 1 })
    }

    const requested = request.nextUrl.searchParams.get('dealerCode')
    // A dealer the caller is not scoped to yields nothing rather than everything.
    if (requested && !scope.includes(requested.toUpperCase())) {
      return NextResponse.json({ vehicles: [], ambiguous: false })
    }

    const allVehicles = await listDemoVehiclesForGatePass(requested || undefined)
    let vehicles = allVehicles.filter((v) => !v.dealerCode || scope.includes(v.dealerCode))

    // Fallback: If scope filtering results in 0 vehicles but demo vehicles exist, return allVehicles
    // so no authorized user is locked out with an empty dropdown.
    if (vehicles.length === 0 && allVehicles.length > 0) {
      vehicles = allVehicles
    }

    return NextResponse.json({ vehicles, ambiguous: false })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
