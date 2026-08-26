import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { listCustomers } from '@/lib/customer-360/reader'
import {
  CUSTOMER_BRANDS, CUSTOMER_BRAND_LIST, DEFAULT_CUSTOMER_BRAND, isCustomerBrand,
} from '@/lib/customer-360/brands'
import { redactKiaCustomerSummary } from '@/lib/kia/customer-profile/redact'
import type { KiaCustomerGaps } from '@/lib/kia/customer-profile/reader'

// The KIA directory stitches six feeds together; a cold pooler connection alone costs ~1.8s.
export const maxDuration = 60

const GAP_KEYS: (keyof KiaCustomerGaps)[] = [
  'enquiryNoBooking',
  'bookingNoInsurance',
  'noRecentService',
  'openComplaint',
  'insuranceLapsed',
  'bookedNotDelivered',
]

/**
 * CUSTOMER 360 — the buyer directory, for any brand.
 *
 * ⚠️ Gated on `customer_360.view`, NOT on a brand key.
 *
 * This route replaced /api/brands/kia/customer-profile, which was gated on
 * `kia.customer_profile.view`. When that section was retired the key was deleted from the registry,
 * and because `canUserAccessPermission` resolves `snapshot.effective[key] === true`, a key that no
 * longer exists resolves to FALSE for everyone except a super admin. The section kept rendering (it
 * checks the new key) while its data call 403'd for every ordinary user — including the MD. A
 * removed permission key does not fail open; it fails silently, for everybody but the person who
 * removed it.
 *
 * Brand access is still enforced, per brand, below: `customer_360.view` says you may use the
 * section, and `canAccessBrand` says which brands' customers you may see inside it.
 */
export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const granted = await requirePermission(appUser, 'customer_360.view')
  if (!granted.allowed) return NextResponse.json({ error: granted.reason }, { status: 403 })

  const url = new URL(request.url)
  const requestedBrand = url.searchParams.get('brand')
  const brand = isCustomerBrand(requestedBrand) ? requestedBrand : DEFAULT_CUSTOMER_BRAND

  // A brand the user does not hold is refused outright rather than returning an empty list: "no
  // customers" and "not your brand" must not look the same.
  if (!canAccessBrand(appUser, brand)) {
    return NextResponse.json({ error: `You do not have access to ${CUSTOMER_BRANDS[brand].label}.` }, { status: 403 })
  }

  /*
   * ⚠️ `request` is deliberately NOT handed to a blanket dealer-scope guard.
   *
   * enforceDealerScope 403s whenever `dealer_code` is absent, because on a normal report route
   * absent means "give me every branch". Here the scope is applied as a PREDICATE inside the reader
   * instead: a branch user sees their branch and cannot widen it, because `dealerScope` is applied
   * on top of whatever `dealer_code` they choose.
   */
  const dealerScope = getUserDealerScope(appUser, brand)

  const gapParam = url.searchParams.get('gap')
  const gap = GAP_KEYS.includes(gapParam as keyof KiaCustomerGaps)
    ? (gapParam as keyof KiaCustomerGaps)
    : null

  try {
    const result = await listCustomers(brand, {
      search: url.searchParams.get('search'),
      dealerCode: url.searchParams.get('dealer_code'),
      dealerScope,
      gap,
      serviceGapMonths: Number(url.searchParams.get('service_gap_months')) || null,
      page: Number(url.searchParams.get('page')) || 1,
      pageSize: Number(url.searchParams.get('page_size')) || 25,
    })

    return NextResponse.json({
      ...result,
      brand,
      capabilities: CUSTOMER_BRANDS[brand].capabilities,
      salesOnly: CUSTOMER_BRANDS[brand].salesOnly,
      // Only the brands this user actually holds, so the selector cannot offer a tab that 403s.
      brands: CUSTOMER_BRAND_LIST
        .filter((config) => canAccessBrand(appUser, config.brand))
        .map((config) => ({ brand: config.brand, label: config.label, salesOnly: config.salesOnly })),
      // Redact BEFORE the rows leave this handler. The client never receives what it must not show.
      rows: result.rows.map((row) => redactKiaCustomerSummary(row, appUser.role)),
    })
  } catch (error) {
    console.error('[customer-360] list failed', error)
    return NextResponse.json({ error: 'Failed to load customer directory' }, { status: 500 })
  }
}
