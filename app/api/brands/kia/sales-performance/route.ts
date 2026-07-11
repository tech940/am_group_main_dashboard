import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaSalesPerformance } from '@/lib/kia/sales-performance'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse
    const appUser = await getAuthenticatedAppUser()
    const permission = await requirePermission(appUser, 'kia.sales_performance.view')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const url = new URL(request.url)
    const yearParam = url.searchParams.get('year')
    const monthParam = url.searchParams.get('month')
    const data = await getKiaSalesPerformance({
      year: yearParam ? Number(yearParam) : null,
      month: monthParam ? Number(monthParam) : null,
      dealerCode: url.searchParams.get('dealer_code'),
    })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to load KIA sales performance:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load sales performance' }, { status: 500 })
  }
}
