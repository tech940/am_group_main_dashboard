import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewFuelApprovals } from '@/lib/fuel-approvals/view-access'
import { listLinkableFuelPasses } from '@/lib/fuel-approvals/accountability'

export const dynamic = 'force-dynamic'

/**
 * The "Fuel filling" gate passes a fuel request can be linked to — for the picker on the request form.
 * Same gate as raising a request. `?forRequest=<id>` keeps that request's own link in the list on re-submit.
 *
 * It returns the pass number, the car, the gate times and the pump reading only — no driver, licence or photo.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await canViewFuelApprovals(user))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

    const forRequest = request.nextUrl.searchParams.get('forRequest')
    const passes = await listLinkableFuelPasses({
      forRequestId: forRequest && /^[0-9a-f-]{36}$/i.test(forRequest) ? forRequest : null,
    })
    return NextResponse.json({ passes }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Failed to list fuel-filling gate passes:', error)
    return NextResponse.json({ error: 'Could not load gate passes' }, { status: 500 })
  }
}
