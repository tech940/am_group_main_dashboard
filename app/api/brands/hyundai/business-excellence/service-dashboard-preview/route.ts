import { NextResponse } from 'next/server'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'
import { buildHyundaiServiceDashboardPreview } from '@/lib/hyundai/service-dashboard-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const PREVIEW_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300'

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-service-dashboard-preview')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('hyundai'))
  if (accessError) return accessError
  const { searchParams } = new URL(request.url)
  try {
    const preview = await timer.time('preview', () => buildHyundaiServiceDashboardPreview({
      endDate: searchParams.get('endDate') || searchParams.get('date'),
      dealerCode: normalizeHyundaiDealerCode(searchParams.get('dealer_code')),
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(preview, {
      headers: { 'Cache-Control': PREVIEW_CACHE_CONTROL },
    }), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to preview Hyundai Service Dashboard:', error)
    return NextResponse.json({ error: 'Failed to preview Hyundai Service Dashboard' }, { status: 500 })
  }
}
