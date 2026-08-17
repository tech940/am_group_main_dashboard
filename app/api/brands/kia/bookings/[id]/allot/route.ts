import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { allotKiaBookingVehicle } from '@/lib/kia/bookings'
import { MAX_EXTENSION_DAYS, MIN_EXTENSION_DAYS, isValidExtensionDays } from '@/lib/kia/payment-window-requests'
import { notifyMdOfPaymentWindowRequest } from '@/lib/kia/payment-window-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorize() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse, appUser: null }
  const appUser = await getAuthenticatedAppUser()
  const permission = await requirePermission(appUser, 'kia.bookings.edit')
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }), appUser }
  return { response: null, appUser }
}

export async function POST(request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]/allot'>) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await context.params
    const body = await request.json()

    // Optional request for a longer payment window. The allotment below still applies the STANDARD
    // window — this only records the ask for the MD. Days arrive as a string from the form, so
    // parse before validating.
    const rawDays = body.extraTimeDays
    const extraTimeDays = rawDays === undefined || rawDays === null || rawDays === '' ? null : Number(rawDays)
    let extraTime: { days: number; reason: string } | undefined
    if (extraTimeDays !== null) {
      if (!isValidExtensionDays(extraTimeDays)) {
        return NextResponse.json({
          error: `Extra time must be a whole number of days between ${MIN_EXTENSION_DAYS} and ${MAX_EXTENSION_DAYS}.`,
        }, { status: 400 })
      }
      const reason = String(body.extraTimeReason ?? '').trim()
      if (!reason) {
        return NextResponse.json({ error: 'Please give a reason for the extra time request.' }, { status: 400 })
      }
      extraTime = { days: extraTimeDays, reason }
    }

    const booking = await allotKiaBookingVehicle(id, body.vinNumber, auth.appUser!, { extraTime })

    // Fire-and-forget: the allotment has already committed, so a mail failure must not surface as a
    // failed allotment. notifyMdOfPaymentWindowRequest never throws, but .catch() guards the void.
    if (extraTime) {
      void notifyMdOfPaymentWindowRequest({
        bookingId: id,
        requestedDays: extraTime.days,
        reason: extraTime.reason,
        requestedByName: auth.appUser!.fullName,
      }).catch((error) => console.error('[kia/allot] extra-time MD email failed', error))
    }

    return NextResponse.json({ ok: true, booking, extraTimeRequested: Boolean(extraTime) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to allot vehicle' }, { status: 400 })
  }
}
