import { NextResponse } from 'next/server'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'
import { buildHyundaiServiceDashboardExport } from '@/lib/hyundai/service-dashboard-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-service-dashboard-export')
  const accessError = await timer.time('auth', () => requireBrandSectionApiAccess('hyundai', 'hyundai.business_excellence.view', request))
  if (accessError) return accessError
  const { searchParams } = new URL(request.url)
  try {
    const result = await timer.time('workbook', () => buildHyundaiServiceDashboardExport({
      endDate: searchParams.get('endDate') || searchParams.get('date'),
      dealerCode: normalizeHyundaiDealerCode(searchParams.get('dealer_code')),
    }))
    const timing = timer.finish()
    return withServerTiming(new Response(result.buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        'Cache-Control': 'no-store',
      },
    }), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to export Hyundai Service Dashboard:', error)
    return NextResponse.json({ error: 'Failed to export Hyundai Service Dashboard' }, { status: 500 })
  }
}
