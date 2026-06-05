import { NextResponse } from 'next/server'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requirePermission } from '@/lib/permissions/service'
import {
  buildHyundaiRoBillingAnalysis,
  createHyundaiCacheKey,
  getHyundaiDateFilters,
} from '@/lib/hyundai/business-excellence'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function growth(cy: number, ly: number) {
  return ly ? ((cy - ly) / ly) * 100 : null
}

async function buildIntelligencePayload(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const filters = getHyundaiDateFilters(searchParams)
  const analysis = await buildHyundaiRoBillingAnalysis(filters, 'load')
  const revenueGrowth = growth(analysis.summary.revenue, analysis.comparisonSummary.revenue)
  const labourPerVehicleGrowth = growth(analysis.summary.labourPerVehicle, analysis.comparisonSummary.labourPerVehicle)
  const partsPerVehicleGrowth = growth(analysis.summary.partsPerVehicle, analysis.comparisonSummary.partsPerVehicle)
  const sourceStatus = analysis.meta.warning ? 'sample' : 'live'

  const alertRows = [
    {
      type: revenueGrowth !== null && revenueGrowth < 0 ? 'Revenue Risk' : 'Revenue Momentum',
      signal: revenueGrowth !== null && revenueGrowth < 0 ? 'Revenue is below comparison period.' : 'Revenue is above or stable vs comparison period.',
      value: revenueGrowth,
      severity: revenueGrowth !== null && revenueGrowth < 0 ? 'High' : 'Low',
    },
    {
      type: 'Labour Efficiency',
      signal: labourPerVehicleGrowth !== null && labourPerVehicleGrowth < 0 ? 'Labour per vehicle is declining.' : 'Labour per vehicle is holding.',
      value: labourPerVehicleGrowth,
      severity: labourPerVehicleGrowth !== null && labourPerVehicleGrowth < 0 ? 'Medium' : 'Low',
    },
    {
      type: 'Parts Opportunity',
      signal: partsPerVehicleGrowth !== null && partsPerVehicleGrowth < 0 ? 'Parts per vehicle is below comparison.' : 'Parts per vehicle is contributing positively.',
      value: partsPerVehicleGrowth,
      severity: partsPerVehicleGrowth !== null && partsPerVehicleGrowth < 0 ? 'Medium' : 'Low',
    },
  ]

  return {
    sourceStatus,
    sourceLabel: sourceStatus === 'live' ? 'Live Hyundai RO billing data' : 'Sample Data / Source Pending',
    meta: {
      ...analysis.meta,
      sourceStatus,
    },
    metrics: {
      revenueGrowth,
      labourPerVehicleGrowth,
      partsPerVehicleGrowth,
      load: analysis.summary.load,
      revenue: analysis.summary.revenue,
      alertCounts: {
        high: alertRows.filter((row) => row.severity === 'High').length,
        medium: alertRows.filter((row) => row.severity === 'Medium').length,
        low: alertRows.filter((row) => row.severity === 'Low').length,
      },
    },
    advisorScores: analysis.leaderboard.map((advisor, index) => ({
      advisor: advisor.advisor,
      score: Math.max(35, 96 - index * 4),
      transactions: advisor.load,
      alerts: index > 5 ? 2 : index > 2 ? 1 : 0,
      revenue: advisor.revenue,
    })),
    rows: alertRows,
    rules: [
      { key: 'revenue_growth', label: 'Revenue Growth', description: 'Flags revenue movement against selected comparison period.' },
      { key: 'labour_per_vehicle', label: 'Labour / Vehicle', description: 'Highlights labour efficiency movement.' },
      { key: 'parts_per_vehicle', label: 'Parts / Vehicle', description: 'Highlights parts penetration movement.' },
    ],
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-performance-intelligence')

  try {
    const appUser = await timer.time('auth', async () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'hyundai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', async () => requirePermission(appUser, 'hyundai.business_excellence.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const filters = getHyundaiDateFilters(new URL(request.url).searchParams)
    const cacheKey = createHyundaiCacheKey('performance-intelligence', filters)
    const payload = await timer.time('performance-intelligence', async () => getCachedData(
      cacheKey,
      () => buildIntelligencePayload(request),
      CACHE_TTL.DASHBOARD,
    ))

    const finished = timer.finish()
    return withServerTiming(NextResponse.json(payload), finished.serverTiming)
  } catch (error) {
    console.error('Error in GET /api/brands/hyundai/business-excellence/performance-intelligence:', error)
    const finished = timer.finish()
    return withServerTiming(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), finished.serverTiming)
  }
}
