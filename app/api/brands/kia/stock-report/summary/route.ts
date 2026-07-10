import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaStockReportSummary } from '@/lib/kia/stock-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60



export async function GET(request: Request) {
  const timer = createApiTimer('kia-stock-report-summary')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.stock_report.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    if (url.searchParams.get('refresh') === 'true') {
      const { invalidateCachePattern } = await import('@/lib/redis/cache-utils')
      await invalidateCachePattern('kia:stock-report:*')
    }
    const data = await timer.time('summary', () => getKiaStockReportSummary({
      dealerCode: url.searchParams.get('dealer_code'),
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build KIA stock report summary:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA stock report summary' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
