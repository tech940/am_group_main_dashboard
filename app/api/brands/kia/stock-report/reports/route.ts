import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaStockReportCsv, getKiaStockReportTable } from '@/lib/kia/stock-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseYear(value: string | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 2000 ? Math.floor(parsed) : null
}

function parseMonthIndex(value: string | null) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return null
  return Math.floor(parsed) - 1
}

function parseDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function isKiaStockReportRoleAllowed(role: string | null | undefined) {
  return role === 'super_admin' || role === 'md'
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
      year: parseYear(url.searchParams.get('year')),
      month: parseMonthIndex(url.searchParams.get('month')),
      startDate: parseDate(url.searchParams.get('startDate')),
      endDate: parseDate(url.searchParams.get('endDate')),
      dealerCode: url.searchParams.get('dealer_code'),
      dateMode: url.searchParams.get('dateMode'),
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
