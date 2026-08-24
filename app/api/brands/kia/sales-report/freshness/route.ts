import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaSalesReportFreshness } from '@/lib/kia/sales-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const timer = createApiTimer('kia-sales-report-freshness')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.sales_report.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    /*
     * Explicit user refresh — same contract as the summary and reports routes.
     *
     * The wipe MUST happen inside the request that then reads, not from a separate "bust" endpoint:
     * getCachedData checks a per-PROCESS L1 cache before Redis, so on Vercel a bust that lands on
     * one lambda leaves another lambda's L1 untouched and the next read still serves stale data.
     * Wiping inline guarantees the payload this very response returns is freshly computed.
     */
    if (url.searchParams.get('refresh') === 'true') {
      const { invalidateCachePattern } = await import('@/lib/redis/cache-utils')
      await invalidateCachePattern('kia:sales-report:*')
    }

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
