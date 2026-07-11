import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { upsertKiaSalesTargets } from '@/lib/kia/sales-performance'

export const dynamic = 'force-dynamic'

// Only managers may set targets (viewers can still see the leaderboard via the view permission).
const TARGET_MANAGER_ROLES = new Set(['general_manager', 'sales_manager', 'sales_head', 'md', 'eba', 'admin', 'developer'])

export async function POST(request: Request) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await requirePermission(appUser, 'kia.sales_performance.view')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    if (!TARGET_MANAGER_ROLES.has(appUser.role)) {
      return NextResponse.json({ error: 'Only managers can set sales targets.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as { year?: number; month?: number; entries?: unknown }
    const result = await upsertKiaSalesTargets(appUser, {
      year: Number(body.year),
      month: Number(body.month),
      entries: Array.isArray(body.entries) ? body.entries as { dealerCode: string; consultantName: string; bookingTarget: number; deliveryTarget: number }[] : [],
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to save KIA sales targets:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save targets' }, { status: 500 })
  }
}
