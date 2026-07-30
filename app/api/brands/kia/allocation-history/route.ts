import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createDbGate } from '@/lib/db/concurrency'
import { getAllocationHistory, getAllocationHistorySummary } from '@/lib/kia/allocation-history'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Vehicle allocation history — read-only audit trail.
 *
 * GET only, and there is deliberately no PATCH/DELETE: an audit trail the audited party can edit is
 * not an audit trail. Rows are written by the allocate/release paths and the expiry sweep; nothing
 * here mutates them.
 */
export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)

    // Branch-scoped like the rest of KIA: a manager pinned to one dealer sees only that dealer's
    // allocations. Super-admins and unpinned roles see everything.
    let dealerCode = searchParams.get('dealerCode')
    const allowed = getUserDealerScope(appUser, 'kia')
    if (allowed && allowed.length > 0) {
      const requested = (dealerCode || '').trim().toUpperCase()
      dealerCode = requested && allowed.includes(requested) ? requested : allowed[0]
    }

    const filters = {
      search: searchParams.get('search'),
      outcome: searchParams.get('outcome'),
      dealerCode,
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      page: Number(searchParams.get('page')) || 1,
      pageSize: Number(searchParams.get('pageSize')) || 50,
    }

    const gate = createDbGate()
    const [history, summary] = await Promise.all([
      gate(() => getAllocationHistory(filters)),
      gate(() => getAllocationHistorySummary(filters)),
    ])

    return NextResponse.json({ ...history, summary, scopedDealers: allowed })
  } catch (error) {
    console.error('[kia:allocation-history:error]', error)
    const message = error instanceof Error ? error.message : 'Failed to load allocation history'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
