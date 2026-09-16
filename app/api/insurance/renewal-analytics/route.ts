import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { filterPermittedInsuranceBrands } from '@/lib/insurance/access'
import { getRenewalAnalytics } from '@/lib/insurance/renewal-analytics'
import { INSURANCE_BRANDS, type InsuranceBrandId } from '@/lib/insurance/brands'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Renewal trend and retention — the analytics beside the work queue in /api/insurance/renewals.
 *
 * ⚠️ Gated identically to the rest of the insurance books — per BRAND, via lib/insurance/access.ts.
 * These are aggregates rather than the PII-dense row list, but they describe the same book and the
 * section's access decision is a single one — do not widen this endpoint on its own.
 *
 * Cached: the underlying queries scan a three-table union of ~41k own-damage policies and take
 * seconds, not milliseconds. The inputs only move when a feed is re-uploaded.
 */
export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })


  const params = new URL(request.url).searchParams
  const rawParam = params.get('brands') || params.get('brand') || params.get('type') || ''
  const requested = rawParam.split(',').map((b) => b.trim()).filter(Boolean)
  /*
   * ⚠️ Narrowed to the brands this user may actually see, rather than refused outright. Someone with
   * Kia but not Hyundai asking for both gets their Kia book — and must NOT get Hyundai's rows folded
   * in silently. An empty result after this means "you may see none of what you asked for".
   */
  const brands = await filterPermittedInsuranceBrands(
    requested.filter((b): b is InsuranceBrandId => b in INSURANCE_BRANDS),
  )
  if (brands.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const graceDays = Math.min(Math.max(Number(params.get('graceDays') || 30), 0), 180)

  try {
    // Local calendar date — toISOString() rolls back a day in IST and would shift every cohort.
    const now = new Date()
    const asOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    const brandKey = (brands.length ? brands : Object.keys(INSURANCE_BRANDS)).slice().sort().join('+')
    // v2 (segments added): bump whenever the payload SHAPE changes, or a stale-shaped entry is served for the TTL.
    const cacheKey = `insurance:renewal-analytics:v2:${asOf}:${brandKey}:${graceDays}`

    const payload = await getCachedData(
      cacheKey,
      () => getRenewalAnalytics({ asOf, brands, graceDays }),
      CACHE_TTL.DASHBOARD,
    )
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Failed to build insurance renewal analytics:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build renewal analytics' },
      { status: 500 },
    )
  }
}
