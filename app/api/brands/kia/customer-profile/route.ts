import { NextResponse } from 'next/server'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { listKiaCustomers, type KiaCustomerGaps } from '@/lib/kia/customer-profile/reader'
import { redactKiaCustomerSummary } from '@/lib/kia/customer-profile/redact'

// The directory stitches six feeds together; a cold pooler connection alone costs ~1.8s.
export const maxDuration = 60

const GAP_KEYS: (keyof KiaCustomerGaps)[] = [
  'enquiryNoBooking',
  'bookingNoInsurance',
  'noRecentService',
  'openComplaint',
  'insuranceLapsed',
  'bookedNotDelivered',
]

export async function GET(request: Request) {
  // Passing `request` is what activates dealer-scope enforcement inside the guard — without it
  // a dealer-restricted user could widen their own scope with a query parameter.
  const denied = await requireBrandSectionApiAccess('kia', 'kia.customer_profile.view', request)
  if (denied) return denied

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const gapParam = url.searchParams.get('gap')
  const gap = GAP_KEYS.includes(gapParam as keyof KiaCustomerGaps)
    ? (gapParam as keyof KiaCustomerGaps)
    : null

  try {
    const result = await listKiaCustomers({
      search: url.searchParams.get('search'),
      dealerCode: url.searchParams.get('dealer_code'),
      gap,
      serviceGapMonths: Number(url.searchParams.get('service_gap_months')) || null,
      page: Number(url.searchParams.get('page')) || 1,
      pageSize: Number(url.searchParams.get('page_size')) || 25,
    })

    return NextResponse.json({
      ...result,
      // Redact BEFORE the rows leave this handler. The client never receives what it must not show.
      rows: result.rows.map((row) => redactKiaCustomerSummary(row, appUser.role)),
    })
  } catch (error) {
    console.error('[kia/customer-profile] list failed', error)
    return NextResponse.json({ error: 'Failed to load customer directory' }, { status: 500 })
  }
}
