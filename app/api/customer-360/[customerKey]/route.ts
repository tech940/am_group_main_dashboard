import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { getCustomerProfile } from '@/lib/customer-360/reader'
import { CUSTOMER_BRANDS, DEFAULT_CUSTOMER_BRAND, isCustomerBrand } from '@/lib/customer-360/brands'
import { parseCustomerKey } from '@/lib/kia/customer-profile/identity'
import { redactKiaCustomerProfile } from '@/lib/kia/customer-profile/redact'
import { availableCategories, buildCustomerTimeline, buildNextBestActions } from '@/lib/kia/customer-profile/timeline'

export const maxDuration = 60

/**
 * CUSTOMER 360 — one customer, for any brand.
 *
 * Gated on `customer_360.view` plus a per-brand access check. See the sibling directory route for
 * why this is not gated on a brand-prefixed permission key.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ customerKey: string }> },
) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const granted = await requirePermission(appUser, 'customer_360.view')
  if (!granted.allowed) return NextResponse.json({ error: granted.reason }, { status: 403 })

  const url = new URL(request.url)
  const requestedBrand = url.searchParams.get('brand')
  const brand = isCustomerBrand(requestedBrand) ? requestedBrand : DEFAULT_CUSTOMER_BRAND

  if (!canAccessBrand(appUser, brand)) {
    return NextResponse.json({ error: `You do not have access to ${CUSTOMER_BRANDS[brand].label}.` }, { status: 403 })
  }

  const { customerKey } = await context.params
  const decoded = decodeURIComponent(customerKey)
  // parseCustomerKey validates the shape: a 17-character VIN (excluding I/O/Q per the VIN standard)
  // or a DMS party key. Anything else is rejected rather than reaching a query.
  if (!parseCustomerKey(decoded)) {
    return NextResponse.json({ error: 'Invalid customer key' }, { status: 400 })
  }

  // The same branch pin the directory applies, so a pinned user cannot open another branch's
  // customer by pasting the key straight into the URL.
  const dealerScope = getUserDealerScope(appUser, brand)

  try {
    const profile = await getCustomerProfile(brand, decoded, {
      serviceGapMonths: Number(url.searchParams.get('service_gap_months')) || null,
      dealerScope,
    })
    if (!profile) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    /*
     * The timeline and the next-best-actions are DERIVED from the payload above — no extra queries.
     * Built on the server so the story is identical wherever it is read, and so the client never has
     * to re-implement the ordering rules.
     *
     * ⚠️ Derived BEFORE redaction, then redacted with the rest. The events carry model, registration
     * and dates rather than contact details, but deriving after redaction would silently build the
     * story out of masked values.
     *
     * For a sales-only brand this yields the purchases and nothing else, which is correct: every
     * other feed is genuinely unreachable, and `capabilities` tells the client to say so rather than
     * render an empty history as an inactive customer.
     */
    const timeline = buildCustomerTimeline(profile)
    const payload = {
      ...profile,
      timeline,
      timelineCategories: availableCategories(timeline),
      nextBestActions: buildNextBestActions(profile),
    }

    return NextResponse.json({
      ...redactKiaCustomerProfile(payload, appUser.role),
      timeline: payload.timeline,
      timelineCategories: payload.timelineCategories,
      nextBestActions: payload.nextBestActions,
      brand,
      capabilities: CUSTOMER_BRANDS[brand].capabilities,
      salesOnly: CUSTOMER_BRANDS[brand].salesOnly,
    })
  } catch (error) {
    console.error('[customer-360] profile failed', error)
    return NextResponse.json({ error: 'Failed to load customer profile' }, { status: 500 })
  }
}
