import { NextResponse } from 'next/server'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { getHyundaiWorkshopSummary } from '@/lib/hyundai/workshop-summary'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-workshop-summary')
  const accessError = await timer.time('auth', () => requireBrandSectionApiAccess('hyundai', 'hyundai.business_excellence.view'))
  if (accessError) return accessError

  try {
    const { searchParams } = new URL(request.url)
    const endDate = searchParams.get('endDate')
    const dealerCode = normalizeHyundaiDealerCode(searchParams.get('dealer_code') || searchParams.get('dealer')) || null

    const data = await timer.time('summary', () => getCachedData(
      `hyundai:business-excellence:workshop-summary:v1:${endDate || 'today'}:${dealerCode || 'all'}`,
      () => getHyundaiWorkshopSummary({ endDate, dealerCode }),
      CACHE_TTL.DASHBOARD,
    ))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Hyundai Workshop Summary:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Workshop Summary' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
