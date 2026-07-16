import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaBookingDetail, updateKiaBooking } from '@/lib/kia/bookings'
import { canViewKiaCustomerPii, redactKiaBookingPii } from '@/lib/kia/pii'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function activityPayload(row: Record<string, unknown>) {
  return {
    id: row.id,
    type: row.activityType,
    message: row.title,
    actorName: row.actorName,
    createdAt: row.createdAt,
  }
}

// `canViewPii` is threaded in from the authorized caller rather than read inside: this payload is the
// single point where the booking leaves the server, and the customer's phone/email/PAN/Aadhaar (plus
// the Storage URLs of their uploaded ID scans) used to ship raw to every role holding
// kia.bookings.view — the client only declined to render them. See lib/kia/pii.ts.
function detailPayload(detail: Awaited<ReturnType<typeof getKiaBookingDetail>>, canViewPii: boolean) {
  if (!detail) return null
  const booking = redactKiaBookingPii(detail.booking as unknown as Record<string, unknown>, canViewPii) as unknown as typeof detail.booking
  return {
    booking: {
      ...booking,
      address: booking.customerAddress,
      colorPreference: booking.color,
      expectedDeliveryDate: booking.deliveryTargetDate,
      proformaNumber: booking.proformaId ? String(booking.proformaId).slice(0, 8).toUpperCase() : null,
      financeOrderNumber: booking.financeOrderId ? String(booking.financeOrderId).slice(0, 8).toUpperCase() : null,
    },
    allocation: detail.activeAllocation,
    proforma: detail.proforma ? {
      id: detail.proforma.id,
      number: String(detail.proforma.id).slice(0, 8).toUpperCase(),
      status: detail.proforma.approvalStatus,
      createdAt: detail.proforma.createdAt,
    } : null,
    financeOrder: detail.financeOrder ? {
      id: detail.financeOrder.id,
      number: detail.financeOrder.orderNumber,
      status: detail.financeOrder.status,
      createdAt: detail.financeOrder.createdAt,
    } : null,
    transfers: detail.transfers.map((transfer) => ({
      id: transfer.id,
      vinNumber: transfer.vinNumber,
      fromDealerCode: transfer.fromDealerCode,
      toDealerCode: transfer.toDealerCode,
      status: transfer.transferStatus,
      createdAt: transfer.createdAt,
    })),
    activities: detail.activity.map((row) => activityPayload(row as unknown as Record<string, unknown>)),
  }
}

async function authorize(permissionKey: string) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse, appUser: null }
  const appUser = await getAuthenticatedAppUser()
  const permission = await requirePermission(appUser, permissionKey)
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }), appUser }
  return { response: null, appUser }
}

export async function GET(_request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]'>) {
  const timer = createApiTimer('kia-booking-detail')
  try {
    const auth = await timer.time('auth', () => authorize('kia.bookings.view'))
    if (auth.response) return auth.response
    const { id } = await context.params
    const detail = await timer.time('detail', () => getKiaBookingDetail(id))
    if (!detail) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: 'Booking not found' }, { status: 404 }), timing.serverTiming)
    }
    const timing = timer.finish()
    return withServerTiming(NextResponse.json(detailPayload(detail, canViewKiaCustomerPii(auth.appUser?.role))), timing.serverTiming)
  } catch (error) {
    console.error('Failed to load KIA booking detail:', error)
    const timing = timer.finish()
    return withServerTiming(NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA booking detail' }, { status: 500 }), timing.serverTiming)
  }
}

export async function PATCH(request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]'>) {
  const timer = createApiTimer('kia-booking-update')
  try {
    const auth = await timer.time('auth', () => authorize('kia.bookings.edit'))
    if (auth.response) return auth.response
    const { id } = await context.params
    const body = await request.json()
    const booking = await timer.time('update', () => updateKiaBooking(id, body, auth.appUser!))
    const timing = timer.finish()
    return withServerTiming(NextResponse.json({ ok: true, booking }), timing.serverTiming)
  } catch (error) {
    console.error('Failed to update KIA booking:', error)
    const timing = timer.finish()
    return withServerTiming(NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update KIA booking' }, { status: 400 }), timing.serverTiming)
  }
}
