import { NextResponse } from 'next/server'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requirePermission } from '@/lib/permissions/service'
import { createHyundaiCacheKey, getHyundaiDateFilters } from '@/lib/hyundai/business-excellence'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function sampleComplaintsPayload(request: Request) {
  const filters = getHyundaiDateFilters(new URL(request.url).searchParams)
  const branchFactor = filters.branch === 'udhampur' ? 0.55 : filters.branch === 'jammu' ? 1 : 1.35
  const total = Math.round(8 * branchFactor)
  const open = Math.max(1, Math.round(total * 0.25))
  const closed = Math.max(0, total - open)
  const lyTotal = Math.max(1, Math.round(total * 1.2))

  return {
    sourceStatus: 'sample',
    sourceLabel: 'Sample Data / Source Pending',
    meta: {
      source: 'hyundai_complaints_source_pending',
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      filters,
      sourceStatus: 'sample',
      warning: 'Hyundai complaints source table is not configured yet. Values below are labelled sample data.',
    },
    kpis: {
      total,
      lyTotal,
      open,
      closed,
      closureRate: total ? (closed / total) * 100 : 0,
      averageAging: 3.8,
      over7Days: Math.max(0, Math.round(open * 0.35)),
      repeatComplaints: Math.max(0, Math.round(total * 0.08)),
    },
    movement: [
      { label: 'Week 1', cy: Math.round(total * 0.2), ly: Math.round(lyTotal * 0.2) },
      { label: 'Week 2', cy: Math.round(total * 0.3), ly: Math.round(lyTotal * 0.25) },
      { label: 'Week 3', cy: Math.round(total * 0.25), ly: Math.round(lyTotal * 0.3) },
      { label: 'Week 4', cy: Math.round(total * 0.25), ly: Math.round(lyTotal * 0.25) },
    ],
    breakdowns: {
      areas: [
        { name: 'Service Experience', total: Math.round(total * 0.45), open: Math.round(open * 0.5), avgDays: 3.2 },
        { name: 'Billing / Invoice', total: Math.round(total * 0.25), open: Math.round(open * 0.2), avgDays: 2.1 },
        { name: 'Parts Availability', total: Math.round(total * 0.2), open: Math.round(open * 0.2), avgDays: 5.4 },
        { name: 'Customer Follow-up', total: Math.max(0, total - Math.round(total * 0.9)), open: Math.max(0, open - Math.round(open * 0.9)), avgDays: 4.7 },
      ],
      statuses: [
        { name: 'Open', value: open },
        { name: 'Closed', value: closed },
      ],
      models: [
        { name: 'Creta', total: Math.round(total * 0.35) },
        { name: 'Venue', total: Math.round(total * 0.25) },
        { name: 'i20', total: Math.round(total * 0.2) },
        { name: 'Others', total: Math.max(0, total - Math.round(total * 0.8)) },
      ],
      sources: [
        { name: 'Call Center', total: Math.round(total * 0.6) },
        { name: 'Dealer', total: Math.round(total * 0.25) },
        { name: 'Walk-in', total: Math.max(0, total - Math.round(total * 0.85)) },
      ],
    },
    rows: Array.from({ length: Math.min(total, 8) }, (_, index) => ({
      complaintNo: `HY-CMP-${String(index + 1).padStart(3, '0')}`,
      customerName: ['Rahul Sharma', 'Sunita Devi', 'Amit Singh', 'Karan Gupta'][index % 4],
      vehicle: ['JK02HX2411', 'JK02CR8481', 'JK14B5508', 'JK02CS5698'][index % 4],
      model: ['Creta', 'Venue', 'i20', 'Verna'][index % 4],
      area: ['Service Experience', 'Billing / Invoice', 'Parts Availability', 'Customer Follow-up'][index % 4],
      status: index < open ? 'Open' : 'Closed',
      days: index < open ? index + 1 : 0,
    })),
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-complaints')

  try {
    const appUser = await timer.time('auth', async () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'hyundai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', async () => requirePermission(appUser, 'hyundai.business_excellence.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const filters = getHyundaiDateFilters(new URL(request.url).searchParams)
    const cacheKey = createHyundaiCacheKey('complaints', filters)
    const payload = await timer.time('complaints', async () => getCachedData(
      cacheKey,
      async () => sampleComplaintsPayload(request),
      CACHE_TTL.DASHBOARD,
    ))

    const finished = timer.finish()
    return withServerTiming(NextResponse.json(payload), finished.serverTiming)
  } catch (error) {
    console.error('Error in GET /api/brands/hyundai/business-excellence/complaints:', error)
    const finished = timer.finish()
    return withServerTiming(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), finished.serverTiming)
  }
}
