import { NextResponse } from 'next/server'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requirePermission } from '@/lib/permissions/service'
import {
  createHyundaiCacheKey,
  getHyundaiDateFilters,
  buildHyundaiFreshness,
} from '@/lib/hyundai/business-excellence'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-freshness')

  try {
    const appUser = await timer.time('auth', async () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'hyundai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', async () => requirePermission(appUser, 'hyundai.business_excellence.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const searchParams = new URL(request.url).searchParams
    const filters = getHyundaiDateFilters(searchParams)
    const cacheKey = createHyundaiCacheKey('freshness', filters)

    const payload = await timer.time('freshness', async () => getCachedData(
      cacheKey,
      () => buildHyundaiFreshness(filters),
      CACHE_TTL.DASHBOARD,
    ))

    const finished = timer.finish()
    return withServerTiming(NextResponse.json(payload), finished.serverTiming)
  } catch (error) {
    console.error('Error in GET /api/brands/hyundai/business-excellence/freshness:', error)
    const finished = timer.finish()
    return withServerTiming(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), finished.serverTiming)
  }
}
