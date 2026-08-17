import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import {
  MAX_EXTENSION_DAYS,
  MIN_EXTENSION_DAYS,
  actOnPaymentWindowRequest,
  isValidExtensionDays,
} from '@/lib/kia/payment-window-requests'
import { notifyRequesterOfPaymentWindowDecision } from '@/lib/kia/payment-window-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * MD approves or rejects an extension request.
 *
 * State conflicts return **409**, not 400 — the request is well-formed, the resource just is not in
 * a state where the action applies. (The discount route returns 400 for the same situation, which is
 * why app/api/md-approvals/[source]/action/route.ts has to special-case it.)
 */
export async function POST(
  request: Request,
  context: RouteContext<'/api/brands/kia/bookings/payment-window-requests/[id]/action'>,
) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await requirePermission(appUser, 'kia.payment_window_requests.approve')
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.reason }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '').toUpperCase()
    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: "action must be 'APPROVE' or 'REJECT'." }, { status: 400 })
    }

    // Only meaningful on approve. Absent means "grant exactly what was asked for".
    let approvedDays: number | undefined
    if (action === 'APPROVE' && body.approvedDays !== undefined && body.approvedDays !== null && body.approvedDays !== '') {
      const parsed = Number(body.approvedDays)
      if (!isValidExtensionDays(parsed)) {
        return NextResponse.json({
          error: `Approved days must be a whole number between ${MIN_EXTENSION_DAYS} and ${MAX_EXTENSION_DAYS}.`,
        }, { status: 400 })
      }
      approvedDays = parsed
    }

    const result = await actOnPaymentWindowRequest(id, appUser!, {
      action,
      approvedDays,
      remarks: body.remarks,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.message, conflict: result.conflict }, { status: 409 })
    }

    // Fire-and-forget: the decision is committed, so a mail failure must not report it as failed.
    void notifyRequesterOfPaymentWindowDecision({
      bookingId: result.request.bookingId,
      decision: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      requesterEmail: result.notify.requesterEmail,
      bookingNumber: result.notify.bookingNumber,
      customerName: result.notify.customerName,
      vinNumber: result.notify.vinNumber,
      requestedDays: result.request.requestedDays,
      approvedDays: result.request.approvedDays,
      newDeadline: result.appliedExpiresAt,
      startsOnArrival: result.startsOnArrival,
      decidedByName: appUser!.fullName,
      remarks: result.request.actionRemarks,
    }).catch((error) => console.error('[payment-window-requests/action] decision email failed', error))

    return NextResponse.json({
      ok: true,
      request: result.request,
      appliedExpiresAt: result.appliedExpiresAt,
      // True when the grant landed earlier than the existing deadline, so the deadline was kept.
      floored: result.floored,
      // True when the car is still in transit — the window opens on arrival, not now.
      startsOnArrival: result.startsOnArrival,
    })
  } catch (error) {
    console.error('[kia/payment-window-requests] action failed', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to action the request',
    }, { status: 400 })
  }
}
