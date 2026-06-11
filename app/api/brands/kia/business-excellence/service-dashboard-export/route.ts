import { NextResponse } from 'next/server'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { buildKiaServiceDashboardExport } from '@/lib/kia/service-dashboard-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const timer = createApiTimer('kia-service-dashboard-export')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('kia'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const endDate = searchParams.get('endDate') || searchParams.get('date')
  const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code'))

  try {
    const exportResult = await timer.time('workbook', () => buildKiaServiceDashboardExport({
      endDate,
      dealerCode,
    }))
    const timing = timer.finish()
    const response = new Response(exportResult.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportResult.fileName}"; filename*=UTF-8''${encodeURIComponent(exportResult.fileName)}`,
        'Cache-Control': 'no-store',
      },
    })

    return withServerTiming(response, timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to export KIA Service Dashboard workbook:', error)
    return NextResponse.json({ error: 'Failed to export KIA Service Dashboard workbook' }, { status: 500 })
  }
}
