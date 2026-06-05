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

function percentageGrowth(cy: number, ly: number) {
  return ly ? ((cy - ly) / ly) * 100 : null
}

function kpi(value: number, previous: number) {
  return {
    value,
    previous,
    growth: percentageGrowth(value, previous),
  }
}

async function buildWorkshopPayload(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const filters = getHyundaiDateFilters(searchParams)
  const analysis = await buildHyundaiRoBillingAnalysis(filters, 'load')
  const sourceStatus = analysis.meta.warning ? 'sample' : 'live'

  return {
    sourceStatus,
    sourceLabel: sourceStatus === 'live' ? 'Live Hyundai RO billing data' : 'Sample Data / Source Pending',
    meta: {
      ...analysis.meta,
      sourceStatus,
      sourceLabel: sourceStatus === 'live' ? 'hyundai_ro_billing_report' : 'Sample Data / Source Pending',
    },
    kpis: {
      totalJc: kpi(analysis.summary.load, analysis.comparisonSummary.load),
      totalRevenue: kpi(analysis.summary.revenue, analysis.comparisonSummary.revenue),
      labourAmount: kpi(analysis.summary.labour, analysis.comparisonSummary.labour),
      spareSale: kpi(analysis.summary.parts, analysis.comparisonSummary.parts),
      labourPerRo: kpi(analysis.summary.labourPerVehicle, analysis.comparisonSummary.labourPerVehicle),
      sparePerRo: kpi(analysis.summary.partsPerVehicle, analysis.comparisonSummary.partsPerVehicle),
      averageBilling: kpi(analysis.summary.averageBilling, analysis.comparisonSummary.averageBilling),
      discount: kpi(analysis.summary.discount, analysis.comparisonSummary.discount),
      vasAmount: {
        ...kpi(Math.round(analysis.summary.revenue * 0.035), Math.round(analysis.comparisonSummary.revenue * 0.028)),
        sourceStatus: 'sample',
        note: 'VAS source table pending for Hyundai.',
      },
      waCount: {
        ...kpi(Math.round(analysis.summary.load * 0.12), Math.round(analysis.comparisonSummary.load * 0.1)),
        sourceStatus: 'sample',
        note: 'WA source table pending for Hyundai.',
      },
      wbCount: {
        ...kpi(Math.round(analysis.summary.load * 0.08), Math.round(analysis.comparisonSummary.load * 0.07)),
        sourceStatus: 'sample',
        note: 'WB source table pending for Hyundai.',
      },
    },
    serviceTypeRows: analysis.byMetric.load,
    coreRows: analysis.byMetric.load.filter((row) => row.serviceType === 'MECH' || row.serviceType === 'Accident' || row.serviceType === 'Grand Total'),
    metricTables: analysis.byMetric,
    dailyTrend: analysis.trend.points,
    revenue: {
      labourRows: analysis.byMetric.labour,
      partsRows: analysis.byMetric.parts,
      contribution: {
        labour: analysis.summary.revenue ? (analysis.summary.labour / analysis.summary.revenue) * 100 : 0,
        parts: analysis.summary.revenue ? (analysis.summary.parts / analysis.summary.revenue) * 100 : 0,
      },
    },
    sourceUpdatedAt: analysis.meta.sourceUpdatedAt,
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-workshop-performance')

  try {
    const appUser = await timer.time('auth', async () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'hyundai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', async () => requirePermission(appUser, 'hyundai.business_excellence.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const filters = getHyundaiDateFilters(new URL(request.url).searchParams)
    const cacheKey = createHyundaiCacheKey('workshop-performance', filters)
    const payload = await timer.time('workshop-performance', async () => getCachedData(
      cacheKey,
      () => buildWorkshopPayload(request),
      CACHE_TTL.DASHBOARD,
    ))

    const finished = timer.finish()
    return withServerTiming(NextResponse.json(payload), finished.serverTiming)
  } catch (error) {
    console.error('Error in GET /api/brands/hyundai/business-excellence/workshop-performance:', error)
    const finished = timer.finish()
    return withServerTiming(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), finished.serverTiming)
  }
}
