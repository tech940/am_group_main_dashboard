import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getLiveRoute } from '@/lib/loconav/live-route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Where a car that is still OUT has been since it left the gate.
 *
 * ⚠️ Gated on `gate_pass.approve`, like the finished route in app/api/gate-pass/[id]/route.ts. A live
 * route is a minute-by-minute record of where a named customer is RIGHT NOW — strictly more sensitive
 * than the historical one, so it is never served to the merely-authenticated.
 *
 * ⚠️ Called by the client AFTER the page renders, never during it. This reaches a third party over
 * the network, and the one mature precedent in this repo for calling a provider from a render is the
 * page hanging. The answer is cached for two minutes inside getLiveRoute to protect the account's
 * 20-request budget.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireGatePassAccess('gate_pass.approve')
  if (access.denied) return access.denied

  try {
    const { id } = await context.params
    return NextResponse.json(await getLiveRoute(id))
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
