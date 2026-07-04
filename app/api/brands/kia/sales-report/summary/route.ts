import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaSalesReportSummary } from '@/lib/kia/sales-report'

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

function isKiaSalesReportRoleAllowed(role: string | null | undefined) {
  return role === 'super_admin' || role === 'md' || role === 'eba'
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-sales-report-summary')

  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!isKiaSalesReportRoleAllowed(appUser?.role)) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }), timing.serverTiming)
    }
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.sales_report.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const url = new URL(request.url)
    const data = await timer.time('summary', () => getKiaSalesReportSummary({
      year: parseYear(url.searchParams.get('year')),
      month: parseMonthIndex(url.searchParams.get('month')),
      startDate: parseDate(url.searchParams.get('startDate')),
      endDate: parseDate(url.searchParams.get('endDate')),
      dealerCode: url.searchParams.get('dealer_code'),
    }))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build KIA sales report summary:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA sales report summary' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
