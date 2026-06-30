import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaSalesReportFreshness } from '@/lib/kia/sales-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isKiaSalesReportRoleAllowed(role: string | null | undefined) {
  return role === 'super_admin' || role === 'md'
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-sales-report-freshness')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!isKiaSalesReportRoleAllowed(appUser?.role)) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }), timing.serverTiming)
    }
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.sales_report.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    const data = await timer.time('freshness', () => getKiaSalesReportFreshness(url.searchParams.get('dealer_code')))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to read KIA sales report freshness:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA sales report freshness' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
