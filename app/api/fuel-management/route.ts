import { NextResponse, type NextRequest } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { getIndiaYmd } from '@/lib/date-time'
import { canViewFuelManagement } from '@/lib/fuel-management/access'
import { resolveFuelManagementPeriod } from '@/lib/fuel-management/metrics'
import { getFuelManagementOverview } from '@/lib/fuel-management/reconciliation'
import type { FuelManagementErrorResponse, FuelManagementResponse } from '@/lib/fuel-management/types'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

function refuse(status: number, error: string) {
  return NextResponse.json<FuelManagementErrorResponse>({ error }, { status, headers: NO_STORE })
}

/**
 * GET /api/fuel-management?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=ALL|JK402|JK501
 *
 * ⚠️ Access is canViewFuelManagement — the SAME predicate app/fuel-management/page.tsx calls. This route used to
 * check only that someone was signed in, so any employee could read every fuel record the page had just refused.
 *
 * Every refusal and failure is `{ error }` with text written for the person on the screen. Database and driver
 * messages are logged here and never sent to the browser.
 */
export async function GET(request: NextRequest) {
  let appUser: AppUser | null
  try {
    appUser = await getAuthenticatedAppUser()
  } catch (error) {
    console.error('[fuel-management] could not resolve the signed-in user:', error)
    return refuse(500, 'We could not confirm your sign-in just now. Please try again.')
  }
  if (!appUser) return refuse(401, 'Your session has ended. Please sign in again.')

  try {
    if (!(await canViewFuelManagement(appUser))) {
      return refuse(403, "You don't have access to Fuel Management. Ask an administrator if you need it.")
    }
  } catch (error) {
    console.error(`[fuel-management] could not resolve access for user ${appUser.id}:`, error)
    return refuse(500, 'We could not check your access just now. Please try again.')
  }

  const { searchParams } = request.nextUrl
  const parsed = resolveFuelManagementPeriod(
    { from: searchParams.get('from'), to: searchParams.get('to'), branch: searchParams.get('branch') },
    getIndiaYmd(),
  )
  if (!parsed.ok) return refuse(400, parsed.error)

  try {
    const overview = await getFuelManagementOverview(parsed.period)
    return NextResponse.json<FuelManagementResponse>(overview, { headers: NO_STORE })
  } catch (error) {
    console.error('[fuel-management] overview failed for', parsed.period, error)
    return refuse(500, 'Fuel figures could not be loaded just now. Please try again in a minute.')
  }
}
