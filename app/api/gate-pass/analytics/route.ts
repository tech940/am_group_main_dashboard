import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePassAnalytics } from '@/lib/gate-pass/analytics'

export const dynamic = 'force-dynamic'

/**
 * Gate Pass Analytics API.
 * Provides aggregations, trend series, model utilization, branch metrics, and driver performance.
 */
export async function GET(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries())
    const analytics = await getGatePassAnalytics(access.appUser, params)
    return NextResponse.json(analytics)
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
