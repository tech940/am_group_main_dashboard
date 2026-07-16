import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getFinancePayoutFilterOptions, listFinancePayouts } from '@/lib/finance/payouts'

export const dynamic = 'force-dynamic'

/**
 * The Finance Payouts ledger list + KPIs + filter options.
 *
 * Read is gated by `finance.view` (the section gate); `finance.edit` decides whether the client
 * renders the fields as editable — the PATCH route re-checks it, so this is only a UI hint.
 * Deliberately NOT cached: the finance team edits these rows all day and a stale ledger is worse
 * than a 60ms query on a small table.
 */
export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permission = await requirePermission(appUser, 'finance.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  const canEdit = (await requirePermission(appUser, 'finance.edit')).allowed

  try {
    const url = new URL(request.url)
    const q = (key: string) => url.searchParams.get(key)
    const [data, options] = await Promise.all([
      listFinancePayouts(appUser, {
        search: q('search'),
        payoutStatus: q('payoutStatus'),
        receiptStatus: q('receiptStatus'),
        dealer: q('dealer'),
        bankVisit: q('bankVisit'),
        from: q('from'),
        to: q('to'),
        page: Number(q('page')) || 1,
        pageSize: Number(q('pageSize')) || undefined,
        sort: (q('sort') as 'delivery_desc' | 'delivery_asc' | 'amount_desc') || undefined,
      }),
      getFinancePayoutFilterOptions(),
    ])
    return NextResponse.json({ ...data, canEdit, options }, {
      // The payload carries customer mobile numbers for md/developer — never let it sit in a shared cache.
      headers: { 'Cache-Control': 'no-store, private' },
    })
  } catch (error) {
    console.error('Error in GET /api/finance/payouts:', error)
    return NextResponse.json({ error: 'Unable to load the payout ledger' }, { status: 500 })
  }
}
