import { NextResponse } from 'next/server'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { buildKiaServiceDashboardPreview } from '@/lib/kia/service-dashboard-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const PREVIEW_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300'

export async function GET(request: Request) {
  const timer = createApiTimer('kia-service-dashboard-preview')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('kia'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const endDate = searchParams.get('endDate') || searchParams.get('date')
  const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code'))

  try {
    const preview = await timer.time('preview', () => buildKiaServiceDashboardPreview({
      endDate,
      dealerCode,
    }))
    const timing = timer.finish()
    const response = NextResponse.json(preview, {
      headers: {
        'Cache-Control': PREVIEW_CACHE_CONTROL,
      },
    })

    return withServerTiming(response, timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build KIA Service Dashboard preview:', error)
    return NextResponse.json({ error: 'Failed to build KIA Service Dashboard preview' }, { status: 500 })
  }
}
