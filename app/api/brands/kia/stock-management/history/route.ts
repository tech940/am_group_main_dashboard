import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getKiaStockManagementHistory } from '@/lib/kia/stock-management'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const timer = createApiTimer('kia-stock-management-history')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.stock_management.audit'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    const data = await timer.time('history', () => getKiaStockManagementHistory({
      dealerCode: url.searchParams.get('dealer_code'),
      status: url.searchParams.get('status'),
      search: url.searchParams.get('search'),
      page: url.searchParams.get('page'),
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to read KIA stock management history:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA stock management history' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
