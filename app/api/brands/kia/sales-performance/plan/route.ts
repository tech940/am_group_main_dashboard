import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getSalesTargetPlan } from '@/lib/kia/sales-target-plan'

export const dynamic = 'force-dynamic'

/**
 * The month's plan against what actually happened.
 *
 * ⚠️ THE SAME THREE GATES AS THE PAGE, in the same order — brand scope, then
 * `kia.sales_performance.view`. Guard/API desync is this codebase's recurring defect class, and the
 * page (app/brands/kia/sales-performance/page.tsx) states exactly this pair. A role list here would
 * 403 precisely the people the Access Map had just granted.
 *
 * ⚠️ NO `details` ON THE ERROR. A raw driver message names columns and constraints to any caller.
 */
export async function GET(request: Request) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const permission = await requirePermission(appUser, 'kia.sales_performance.view')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const yearRaw = Number(searchParams.get('year'))
    const monthRaw = Number(searchParams.get('month'))

    const payload = await getSalesTargetPlan({
      year: Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null,
      month: Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null,
      outlet: searchParams.get('outlet'),
    })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    })
  } catch (error) {
    console.error('Failed to build KIA sales target plan:', error)
    return NextResponse.json({ error: 'Failed to load the sales target plan' }, { status: 500 })
  }
}
