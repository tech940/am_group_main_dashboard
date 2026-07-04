import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaStockReportFreshness } from '@/lib/kia/stock-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isKiaStockReportRoleAllowed(role: string | null | undefined) {
  return role === 'super_admin' || role === 'md' || role === 'eba'
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-stock-report-freshness')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!isKiaStockReportRoleAllowed(appUser?.role)) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }), timing.serverTiming)
    }

    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.stock_report.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    const data = await timer.time('freshness', () => getKiaStockReportFreshness(url.searchParams.get('dealer_code')))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to read KIA stock report freshness:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA stock report freshness' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
