import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getPlatinumRetailReview } from '@/lib/platinum/retail-review'
import { getPlatinumConversionPanel, getPlatinumExchangePanel } from '@/lib/platinum/retail-review-panels'
import { getPlatinumBookingsPanel, getPlatinumEnquiryPanel } from '@/lib/platinum/retail-review-pipeline'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseYear(value: string | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100 ? Math.floor(parsed) : null
}

export async function GET(request: Request) {
  const timer = createApiTimer('platinum-retail-review')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('platinum'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await timer.time('permission', () => requirePermission(appUser, 'platinum.sales_report.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    if (url.searchParams.get('refresh') === 'true') {
      const { invalidateCachePattern } = await import('@/lib/redis/cache-utils')
      await invalidateCachePattern('platinum:retail-review:*')
    }

    const currentYear = parseYear(url.searchParams.get('year'))
    const previousYear = parseYear(url.searchParams.get('previousYear'))
    const rawMonth = url.searchParams.get('month')
    const month = rawMonth ? Number(rawMonth) : null
    const panel = url.searchParams.get('panel') || 'retail'
    const year = currentYear || new Date().getUTCFullYear()

    const cacheKey = `platinum:retail-review:v2:${panel}:${year}:${month ?? 'all'}:${previousYear ?? 'auto'}`
    const payload = await timer.time('query', () => getCachedData(cacheKey, async () => {
      switch (panel) {
        case 'conversion': return getPlatinumConversionPanel(year, month)
        case 'bookings': return getPlatinumBookingsPanel(year)
        case 'enquiries': return getPlatinumEnquiryPanel(year)
        case 'exchange': return getPlatinumExchangePanel(year)
        default: return getPlatinumRetailReview({ currentYear, previousYear })
      }
    }, CACHE_TTL.SHORT))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Platinum retail review:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({
        error: error instanceof Error ? error.message : 'Failed to load Platinum retail review',
      }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
