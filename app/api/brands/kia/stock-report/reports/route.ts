import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaStockReportCsv, getKiaStockReportTable } from '@/lib/kia/stock-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60



function isKiaStockReportRoleAllowed(role: string | null | undefined) {
  return role === 'developer' || role === 'md' || role === 'eba'
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-stock-report-reports')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!isKiaStockReportRoleAllowed(appUser?.role)) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }), timing.serverTiming)
    }

    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.stock_report.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    const filters: Record<string, string[]> = {}
    for (const [key, value] of url.searchParams.entries()) {
      if (key.startsWith('filter_') && value) {
        const columnName = key.slice(7)
        filters[columnName] = value.split(',').map(decodeURIComponent)
      }
    }

    const params = {
      dealerCode: url.searchParams.get('dealer_code'),
      status: url.searchParams.get('status'),
      model: url.searchParams.get('model'),
      search: url.searchParams.get('search'),
      sort: url.searchParams.get('sort'),
      direction: url.searchParams.get('direction'),
      filters,
    }

    if (url.searchParams.get('format') === 'csv') {
      const result = await timer.time('csv', () => getKiaStockReportCsv(params))
      const timing = timer.finish()
      return withServerTiming(new NextResponse(result.content, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        },
      }), timing.serverTiming)
    }

    const data = await timer.time('table', () => getKiaStockReportTable({
      ...params,
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to read KIA stock report table:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA stock report table' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
