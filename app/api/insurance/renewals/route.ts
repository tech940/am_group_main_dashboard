import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { getRenewalPipeline } from '@/lib/insurance/renewals'
import { INSURANCE_BRANDS, type InsuranceBrandId } from '@/lib/insurance/brands'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Insurance renewal work queue.
 *
 * ⚠️ Gated identically to the rest of /insurance (MD + Developer). The rows carry customer names and
 * registration numbers for ~3,700 vehicles, so this is the most PII-dense list in the product. It is
 * deliberately NOT widened to the calling team here — that is an owner decision about who may see
 * customer contact data, not something to grant as a side effect of shipping a queue.
 */
export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewRestrictedAnalytics(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const params = new URL(request.url).searchParams
  const requested = (params.get('brands') || '').split(',').map((b) => b.trim()).filter(Boolean)
  const brands = requested.filter((b): b is InsuranceBrandId => b in INSURANCE_BRANDS)
  const lookaheadDays = Math.min(Math.max(Number(params.get('lookaheadDays') || 90), 1), 365)
  const lapsedDays = Math.min(Math.max(Number(params.get('lapsedDays') || 30), 0), 365)

  try {
    // Local calendar date — toISOString() rolls back a day in IST and would shift every bucket.
    const now = new Date()
    const asOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return NextResponse.json(await getRenewalPipeline({ asOf, brands, lookaheadDays, lapsedDays }))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the renewal pipeline' },
      { status: 500 },
    )
  }
}
