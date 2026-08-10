import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaRetailReview } from '@/lib/kia/retail-review'
import {
  getKiaAccessoriesPanel,
  getKiaConversionPanel,
  getKiaExchangePanel,
} from '@/lib/kia/retail-review-panels'
import { getKiaBookingsPanel, getKiaEnquiryPanel } from '@/lib/kia/retail-review-pipeline'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

/**
 * The MD's retail review — a sub-section of the KIA Sales Report.
 *
 * Deliberately its own route rather than an extension of `summary`: that endpoint resolves ONE
 * period and ONE dealer and is cached under that single range key, whereas this is a two-year x
 * twelve-month x two-outlet matrix. Bolting it on would have meant either breaking the existing
 * cache key or fetching the whole matrix on every ordinary Sales Report load.
 *
 * Access rides on `kia.sales_report.view` — same section, same permission.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseYear(value: string | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100 ? Math.floor(parsed) : null
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-retail-review')

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
    const currentYear = parseYear(url.searchParams.get('year'))
    const previousYear = parseYear(url.searchParams.get('compare_year'))
    const rawMonth = url.searchParams.get('month')
    const month = rawMonth ? Number(rawMonth) : null

    // One route, one panel per request. The four panels sit on different data spines and have
    // very different costs — fetching them together would make the retail chart wait for the
    // accessories scan for no reason.
    const panel = url.searchParams.get('panel') || 'retail'
    const year = currentYear || new Date().getUTCFullYear()

    const cacheKey = `kia:retail-review:v2:${panel}:${year}:${month ?? 'all'}:${previousYear ?? 'auto'}`
    const payload = await timer.time('query', () => getCachedData(cacheKey, async () => {
      switch (panel) {
        case 'conversion': return getKiaConversionPanel(year, month)
        case 'bookings': return getKiaBookingsPanel(year)
        case 'enquiries': return getKiaEnquiryPanel(year)
        case 'exchange': return getKiaExchangePanel(year)
        case 'accessories': return getKiaAccessoriesPanel(year)
        default: return getKiaRetailReview({ currentYear, previousYear })
      }
    }, CACHE_TTL.SHORT))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('[kia/retail-review] failed', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to load retail review' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
