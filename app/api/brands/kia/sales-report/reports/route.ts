import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaSalesReportCsv, getKiaSalesReportTable } from '@/lib/kia/sales-report'

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

export async function GET(request: Request) {
  const timer = createApiTimer('kia-sales-report-reports')

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
    const params = {
      report: url.searchParams.get('report'),
      year: parseYear(url.searchParams.get('year')),
      month: parseMonthIndex(url.searchParams.get('month')),
      dealerCode: url.searchParams.get('dealer_code'),
      source: url.searchParams.get('source'),
      model: url.searchParams.get('model'),
      consultant: url.searchParams.get('consultant'),
      search: url.searchParams.get('search'),
      sort: url.searchParams.get('sort'),
      direction: url.searchParams.get('direction'),
    }

    if (url.searchParams.get('format') === 'csv') {
      const result = await timer.time('csv', () => getKiaSalesReportCsv(params))
      const timing = timer.finish()
      return withServerTiming(new NextResponse(result.content, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        },
      }), timing.serverTiming)
    }

    const data = await timer.time('table', () => getKiaSalesReportTable({
      ...params,
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to read KIA sales report table:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA sales report table' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
