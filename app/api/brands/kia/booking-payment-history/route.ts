import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { canViewBookingPaymentHistory } from '@/lib/kia/booking-payment-history-access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { getKiaBookingPaymentHistory } from '@/lib/kia/receipt-report'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Role allowlist OR an explicit Access-Map grant — must match app/brands/kia/booking-payment-history/page.tsx
  // exactly, or the page renders and every fetch behind it 403s.
  if (!canViewBookingPaymentHistory(appUser.role)
    && !(await isPermissionExplicitlyAllowed(appUser, 'kia.booking_payment_history.view'))) {
    return NextResponse.json({ error: 'You do not have access to booking payment history.' }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const params = url.searchParams
    // Branch boundary: MD/Developer/Admin + EA see every branch (scope = null); a Sales/General
    // Manager sees ONLY their pinned dealer(s). Applied as a hard AND inside the reader, so it also
    // constrains KPIs, breakdowns and the dealer filter facet — the query can never reveal another
    // branch's receipts regardless of the requested `dealer` param.
    const allowedDealers = getUserDealerScope(appUser, 'kia')
    // Deliberately NOT cached: filterable per-request + up-to-the-minute collections. The reader is
    // 3 statements over a ~2k-row table, so cold cost is already low.
    const data = await getKiaBookingPaymentHistory({
      startDate: params.get('startDate'),
      endDate: params.get('endDate'),
      dealer: params.get('dealer'),
      paymentType: params.get('paymentType'),
      search: params.get('search'),
      page: Number(params.get('page')) || 1,
      pageSize: Number(params.get('pageSize')) || 20,
      allowedDealers,
    })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to load KIA booking payment history:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load booking payment history' },
      { status: 500 },
    )
  }
}
