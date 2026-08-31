import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { resolveBrand, brandOf } from '@/lib/insurance/brands'
import { readInsuranceOverview, readInsuranceVehicles } from '@/lib/insurance-360/reader'
import { INSURANCE_SEGMENTS, type InsuranceSegment } from '@/lib/insurance-360/lifecycle'

/**
 * Insurance 360 — the overview and the vehicle table.
 *
 * ⚠️ Gated on `canViewRestrictedAnalytics`, the SAME check app/insurance/page.tsx makes — NOT on a
 * permission key. The Insurance section is deliberately restricted (MD / developer / assistant
 * manager) rather than Access-Map driven, and using a permission key here would let people open this
 * module who cannot open the section it belongs to. That mismatch between a screen's guard and its
 * API is the exact defect class this codebase has shipped twice.
 *
 * This is a new VIEW of data those users can already read, never a new grant.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseSegment(value: string | null): InsuranceSegment | null {
  if (!value) return null
  const upper = value.trim().toUpperCase() as InsuranceSegment
  return (INSURANCE_SEGMENTS as readonly string[]).includes(upper) ? upper : null
}

export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canViewRestrictedAnalytics(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const brand = resolveBrand(url.searchParams.get('brand'))
    const b = brandOf(brand)
    const view = url.searchParams.get('view') === 'vehicles' ? 'vehicles' : 'overview'

    if (view === 'overview') {
      const overview = await readInsuranceOverview(brand)
      return NextResponse.json({
        brand,
        overview,
        /*
         * The UI must not offer a segment the feed cannot populate. KIA has no rollover value at all
         * and cannot yet reach a full year of lapse, so those two pills would be controls that can
         * only ever return nothing — which reads as "we have none" rather than "we cannot tell".
         */
        availableSegments: INSURANCE_SEGMENTS.filter((s) => {
          if (s === 'ROLLOVER') return b.capabilities.hasRollover
          if (s === 'LOST') return b.capabilities.hasLostCoverBucket
          return true
        }),
      })
    }

    const limit = Number(url.searchParams.get('limit') || 50)
    const offset = Number(url.searchParams.get('offset') || 0)
    const { rows, total } = await readInsuranceVehicles(brand, {
      segment: parseSegment(url.searchParams.get('segment')),
      search: url.searchParams.get('q'),
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    })
    return NextResponse.json({ brand, rows, total })
  } catch (error) {
    console.error('GET /api/insurance-360 failed:', error)
    return NextResponse.json({ error: 'Failed to load insurance relationships' }, { status: 500 })
  }
}
