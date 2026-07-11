import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaCallAnalytics } from '@/lib/kia/call-analytics'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.call_analytics.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const url = new URL(request.url)
    const days = Number(url.searchParams.get('days')) || 30
    const dealer = url.searchParams.get('dealer') || 'all'
    // Manager dashboard over a rolling window — 10 aggregate queries. It tolerates a few minutes of
    // staleness, so cache it (5 min) to turn repeat loads into instant L1/Redis hits.
    const data = await getCachedData(
      `kia:call-analytics:v1:${days}:${dealer}`,
      () => getKiaCallAnalytics({ days, dealer: dealer === 'all' ? null : dealer }),
      CACHE_TTL.SHORT,
    )
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to load KIA call analytics:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load analytics' }, { status: 500 })
  }
}
