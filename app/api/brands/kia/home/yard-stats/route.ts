import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaYardStats } from '@/lib/kia/home-yard-stats'

export const dynamic = 'force-dynamic'

// Live counts for the home page's stock-yard labels. Gated on kia.stock_report.view — the
// STRICTEST of the three underlying sections (Stock Report is a sensitive, top-management-default
// analytic): stock counts must not leak to every role just because the hero is decorative. The
// client treats a 403 as "render labels without numbers", so nothing breaks for ungranted users.
export async function GET() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.stock_report.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    return NextResponse.json(await getKiaYardStats())
  } catch (error) {
    console.error('Failed to load KIA yard stats:', error)
    return NextResponse.json({ error: 'Failed to load yard stats' }, { status: 500 })
  }
}
