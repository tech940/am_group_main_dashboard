import { NextResponse } from 'next/server'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requirePermission } from '@/lib/permissions/service'
import {
  buildHyundaiOpenRo,
  buildHyundaiRoBillingAnalysis,
  createHyundaiCacheKey,
  getHyundaiDateFilters,
} from '@/lib/hyundai/business-excellence'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type SummaryBody = {
  report?: string
}

function growth(cy: number, ly: number) {
  return ly ? ((cy - ly) / ly) * 100 : null
}

function signed(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'No comparison'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

async function buildAiSummary(request: Request, body?: SummaryBody) {
  const filters = getHyundaiDateFilters(new URL(request.url).searchParams)
  const [analysis, openRo] = await Promise.all([
    buildHyundaiRoBillingAnalysis(filters, 'load'),
    buildHyundaiOpenRo(filters),
  ])
  const revenueGrowth = growth(analysis.summary.revenue, analysis.comparisonSummary.revenue)
  const labourGrowth = growth(analysis.summary.labour, analysis.comparisonSummary.labour)
  const partsGrowth = growth(analysis.summary.parts, analysis.comparisonSummary.parts)
  const sourceStatus = analysis.meta.warning || openRo.meta.warning ? 'sample' : 'live'
  const report = body?.report || 'Hyundai Business Excellence'

  return {
    sourceStatus,
    sourceLabel: sourceStatus === 'live' ? 'Live Hyundai data' : 'Sample Data / Source Pending',
    generatedAt: new Date().toISOString(),
    report,
    filters,
    structuredSummary: {
      title: `${report} executive read`,
      goodNews: [
        `Revenue movement: ${signed(revenueGrowth)} vs comparison period.`,
        `Parts movement: ${signed(partsGrowth)} vs comparison period.`,
        `${analysis.summary.load.toLocaleString('en-IN')} closed repair orders in the selected period.`,
      ],
      badNews: [
        labourGrowth !== null && labourGrowth < 0
          ? `Labour revenue is down ${signed(labourGrowth)} vs comparison.`
          : `Open RO queue currently has ${openRo.summary.totalOpenRo.toLocaleString('en-IN')} vehicles.`,
        `${openRo.summary.over15Days.toLocaleString('en-IN')} open ROs are over 15 days.`,
      ],
      immediateActions: [
        'Review labour per vehicle and parts per vehicle movement before the next review.',
        'Prioritize delayed and 15+ day open repair orders.',
        sourceStatus === 'sample' ? 'Connect pending Hyundai source tables to replace sample markers.' : 'Use live rows for advisor-level follow-up.',
      ],
    },
    metrics: {
      revenue: analysis.summary.revenue,
      labour: analysis.summary.labour,
      parts: analysis.summary.parts,
      load: analysis.summary.load,
      openRo: openRo.summary.totalOpenRo,
      over15Days: openRo.summary.over15Days,
    },
  }
}

async function authorize() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!canAccessBrand(appUser, 'hyundai')) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const permission = await requirePermission(appUser, 'hyundai.business_excellence.view')
  if (!permission.allowed) return { error: NextResponse.json({ error: permission.reason }, { status: 403 }) }
  return { appUser }
}

export async function POST(request: Request) {
  const timer = createApiTimer('hyundai-ai-summary')

  try {
    const auth = await timer.time('auth', async () => authorize())
    if (auth.error) return auth.error
    const body = await request.json().catch(() => ({} as SummaryBody))
    const filters = getHyundaiDateFilters(new URL(request.url).searchParams)
    const cacheKey = createHyundaiCacheKey('ai-summary', filters, { report: body.report || 'Hyundai Business Excellence' })
    const payload = await timer.time('ai-summary', async () => getCachedData(
      cacheKey,
      () => buildAiSummary(request, body),
      CACHE_TTL.DASHBOARD,
    ))
    const finished = timer.finish()
    return withServerTiming(NextResponse.json(payload), finished.serverTiming)
  } catch (error) {
    console.error('Error in POST /api/brands/hyundai/business-excellence/ai-summary:', error)
    const finished = timer.finish()
    return withServerTiming(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), finished.serverTiming)
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-ai-summary-get')

  try {
    const auth = await timer.time('auth', async () => authorize())
    if (auth.error) return auth.error
    const filters = getHyundaiDateFilters(new URL(request.url).searchParams)
    const cacheKey = createHyundaiCacheKey('ai-summary-get', filters)
    const payload = await timer.time('ai-summary', async () => getCachedData(
      cacheKey,
      () => buildAiSummary(request),
      CACHE_TTL.DASHBOARD,
    ))
    const finished = timer.finish()
    return withServerTiming(NextResponse.json(payload), finished.serverTiming)
  } catch (error) {
    console.error('Error in GET /api/brands/hyundai/business-excellence/ai-summary:', error)
    const finished = timer.finish()
    return withServerTiming(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), finished.serverTiming)
  }
}
