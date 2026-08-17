import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import {
  countPendingPaymentWindowRequests,
  findCompetingBookings,
  listPaymentWindowRequests,
} from '@/lib/kia/payment-window-requests'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The MD's queue of payment-window extension requests.
 *
 * Gated on a real permission key rather than a hardcoded role array. The comparable discount feature
 * inlines role lists in both the route and the JSX, and they have already drifted apart — 'edp' is
 * enabled client-side but rejected server-side, so those users get a button that 403s.
 */
export async function GET(request: NextRequest) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await requirePermission(appUser, 'kia.payment_window_requests.view')
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.reason }, { status: 403 })
    }

    // Badge mode: the tab counter needs a single number, not the full queue and certainly not the
    // competing-bookings query, which is the expensive part of this endpoint. Kept on the same route
    // so the counter can never diverge from what the queue shows.
    if (request.nextUrl.searchParams.get('countOnly') === '1') {
      return NextResponse.json({ pendingCount: await countPendingPaymentWindowRequests() })
    }

    const status = request.nextUrl.searchParams.get('status') || undefined
    const rows = await listPaymentWindowRequests({ status })

    // Competing bookings only matter while a decision is outstanding, and the query is the expensive
    // part of this endpoint — so it runs for PENDING rows only, batched into one statement.
    const pendingAllocationIds = rows
      .filter((row) => row.status === 'PENDING' && row.allocationId)
      .map((row) => row.allocationId)
    const competing = await findCompetingBookings(pendingAllocationIds)

    return NextResponse.json({
      rows: rows.map((row) => {
        const contenders = competing.get(row.allocationId) || []
        return {
          ...row,
          competingBookings: contenders,
          competingCount: contenders.length,
          // The headline number: bookings that arrived AFTER this car was allotted. That is the
          // demand the MD is being asked to keep waiting.
          competingNewerCount: contenders.filter((c) => c.isNewerThanAllocation).length,
        }
      }),
    })
  } catch (error) {
    console.error('[kia/payment-window-requests] list failed', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to load payment window requests',
    }, { status: 500 })
  }
}
