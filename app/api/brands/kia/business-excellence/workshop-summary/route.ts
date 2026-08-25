import { NextResponse } from 'next/server'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { getKiaWorkshopSummary } from '@/lib/kia/workshop-summary'
import { getServiceTargetsForBe, resolveTargetPeriod } from '@/lib/targets/be-target-reader'

export const dynamic = 'force-dynamic'

const BRAND = 'kia'

export async function GET(request: Request) {
  const timer = createApiTimer('kia-workshop-summary')
  // `request` is REQUIRED here, not decorative: requireBrandSectionApiAccess only enforces the
  // caller's dealer/branch scope when it can see the query string. Without it this route read
  // `dealer_code` (below) with no check, so a user pinned to one outlet could read the other's
  // numbers by editing the URL.
  const accessError = await timer.time('auth', () => requireBrandSectionApiAccess('kia', 'kia.business_excellence.view', request))
  if (accessError) return accessError

  try {
    const { searchParams } = new URL(request.url)
    const endDate = searchParams.get('endDate')
    const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code') || searchParams.get('dealer')) || null

    const data = await timer.time('summary', () => getCachedData(
      `kia:business-excellence:workshop-summary:v1:${endDate || 'today'}:${dealerCode || 'all'}`,
      () => getKiaWorkshopSummary({ endDate, dealerCode }),
      CACHE_TTL.DASHBOARD,
    ))

    // ⚠️ Deliberately OUTSIDE getCachedData. Inside, a target the MD just saved would stay invisible
    // for up to CACHE_TTL.DASHBOARD (30 minutes) — and every payload-shape change would then need the
    // cache key bumped. Out here the cached object is untouched, so `workshop-summary:v1` still holds
    // and a saved target appears on the next reload. It is one indexed read of a tiny table.
    const period = resolveTargetPeriod(endDate)
    const targets = await timer.time('targets', () =>
      getServiceTargetsForBe(BRAND, period.year, period.month, dealerCode))

    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ ...data, targets, targetPeriod: period }),
      timing.serverTiming,
    )
  } catch (error) {
    console.error('Failed to build KIA Workshop Summary:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Workshop Summary' }, { status: 500 }),
      timing.serverTiming,
    )
  }
}
