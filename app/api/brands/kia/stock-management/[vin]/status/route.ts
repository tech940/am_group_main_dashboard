import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { markKiaStockLocalStatus } from '@/lib/kia/stock-management'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function PATCH(request: Request, context: RouteContext<'/api/brands/kia/stock-management/[vin]/status'>) {
  const timer = createApiTimer('kia-stock-management-status')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.stock_management.edit'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }
    if (!appUser) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), timing.serverTiming)
    }

    const { vin } = await context.params
    const body = await request.json().catch(() => ({}))
    const localStatus = String(body.localStatus || '').toLowerCase()
    if (localStatus !== 'bbnd' && localStatus !== 'retail') {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: 'Invalid local status' }, { status: 400 }), timing.serverTiming)
    }

    const data = await timer.time('mark-status', () => markKiaStockLocalStatus({
      vinNumber: decodeURIComponent(vin),
      localStatus,
      notes: typeof body.notes === 'string' ? body.notes : null,
      appUser,
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to update KIA stock local status:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update local status' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
