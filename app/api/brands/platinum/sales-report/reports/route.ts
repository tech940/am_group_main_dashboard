import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { canViewPlatinumCustomerPii } from '@/lib/platinum/pii'
import { getPlatinumSalesReportCsv, getPlatinumSalesReportTable } from '@/lib/platinum/sales-report'

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

export async function GET(request: Request) {
  const timer = createApiTimer('platinum-sales-report-reports')

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
      await invalidateCachePattern('platinum:sales-report:*')
    }

    const monthKey = url.searchParams.get('monthKey')
    let parsedYear = parseYear(url.searchParams.get('year'))
    let parsedMonth = parseMonthIndex(url.searchParams.get('month'))
    if (!parsedYear && monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
      const [y, m] = monthKey.split('-').map(Number)
      parsedYear = y
      parsedMonth = m - 1
    }

    const canViewPii = canViewPlatinumCustomerPii(appUser?.role)

    const params = {
      canViewPii,
      report: url.searchParams.get('report'),
      year: parsedYear,
      month: parsedMonth,
      monthKey,
      startDate: parseDate(url.searchParams.get('startDate')),
      endDate: parseDate(url.searchParams.get('endDate')),
      dealerCode: url.searchParams.get('dealer_code'),
      search: url.searchParams.get('search'),
    }

    if (url.searchParams.get('format') === 'csv') {
      const result = await timer.time('csv', () => getPlatinumSalesReportCsv(params))
      const timing = timer.finish()
      return withServerTiming(new NextResponse(result.content, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        },
      }), timing.serverTiming)
    }

    const data = await timer.time('table', () => getPlatinumSalesReportTable({
      ...params,
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to read Platinum sales report table:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load Platinum sales report table' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
