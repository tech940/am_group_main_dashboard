import { NextResponse } from 'next/server'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizePlatinumDealerCode } from '@/lib/platinum/dealer-branch'
import { buildPlatinumServiceDashboardPreview } from '@/lib/platinum/service-dashboard-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const PREVIEW_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300'

export async function GET(request: Request) {
  const timer = createApiTimer('platinum-service-dashboard-preview')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('platinum'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const endDate = searchParams.get('endDate') || searchParams.get('date')
  const dealerCode = normalizePlatinumDealerCode(searchParams.get('dealer_code'))

  try {
    const preview = await timer.time('preview', () => buildPlatinumServiceDashboardPreview({
      endDate,
      dealerCode,
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(preview, {
      headers: { 'Cache-Control': PREVIEW_CACHE_CONTROL },
    }), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Platinum Service Dashboard preview:', error)
    return NextResponse.json({ error: 'Failed to build Platinum Service Dashboard preview' }, { status: 500 })
  }
}
